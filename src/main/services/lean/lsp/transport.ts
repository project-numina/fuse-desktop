/**
 * JSON-RPC over LSP-framed stdio streams: request/response correlation with
 * per-request timeouts and `$/cancelRequest`, notifications reduced
 * synchronously in ingress order (so diagnostic state can never reorder),
 * and answers to the handful of server→client requests Lean sends.
 *
 * The transport owns its listeners but not the subprocess supplying the
 * streams; closing it fails every pending request and stops dispatching.
 */

import type { Readable, Writable } from 'node:stream';
import { AbortError } from '../async';
import { LeanLSPError, LSPProtocolError, LSPRequestTimeout, LSPServerError, LSPTransportClosed, type JSONValue } from './errors';
import {
  classifyMessage,
  decodeMessage,
  encodeMessage,
  FrameParser,
  INTERNAL_ERROR,
  JSONRPC_VERSION,
  makeErrorResponse,
  makeMethodMessage,
  METHOD_NOT_FOUND,
  MISSING_PARAMS,
  REQUEST_CANCELLED,
  DEFAULT_MAX_MESSAGE_BYTES,
  type IncomingRequest,
  type JsonRpcMessage,
  type MissingParams,
} from './framing';

export type NotificationReducer = (method: string, params: JSONValue | undefined) => void;
export type RequestHandler = (method: string, params: JSONValue | undefined) => Promise<JSONValue> | JSONValue;

export interface TransportOptions {
  requestTimeoutMs?: number;
  notificationReducer?: NotificationReducer;
  requestHandler?: RequestHandler;
  maxMessageBytes?: number;
}

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface PendingRequest {
  method: string;
  resolve: (value: JSONValue) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout | null;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const CANCELLATION_SEND_TIMEOUT_MS = 250;

export class LspTransport {
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly parser: FrameParser;
  private readonly requestTimeoutMs: number;
  private readonly maxMessageBytes: number;
  private readonly reducer?: NotificationReducer;
  private readonly requestHandler?: RequestHandler;
  private readonly inboundCancelled = new Set<number | string>();
  private started = false;
  private closedFlag = false;
  private terminal: LeanLSPError | null = null;
  private readonly onData = (chunk: Buffer): void => this.receive(chunk);
  private readonly onEnd = (): void => {
    if (!this.closedFlag) this.stop(new LSPTransportClosed(this.parser.pendingBytes ? 'LSP server closed stdout with an incomplete message' : 'LSP server closed stdout'));
  };
  private readonly onStreamError = (error: Error): void => {
    if (!this.closedFlag) this.stop(new LSPTransportClosed(`failed to read LSP transport: ${error.name}: ${error.message}`));
  };
  private readonly onWriteError = (error: Error): void => {
    if (!this.closedFlag) this.stop(new LSPTransportClosed(`failed to write to LSP transport: ${error.message}`));
  };

  constructor(
    private readonly input: Writable,
    private readonly output: Readable,
    options: TransportOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    if (this.requestTimeoutMs <= 0) throw new Error('requestTimeoutMs must be positive');
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.parser = new FrameParser(this.maxMessageBytes);
    this.reducer = options.notificationReducer;
    this.requestHandler = options.requestHandler;
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  get terminalError(): LeanLSPError | null {
    return this.terminal;
  }

  start(): void {
    if (this.closedFlag) throw this.closedError();
    if (this.started) return;
    this.started = true;
    this.output.on('data', this.onData);
    this.output.on('end', this.onEnd);
    this.output.on('close', this.onEnd);
    this.output.on('error', this.onStreamError);
    this.input.on('error', this.onWriteError);
  }

  /** Send a request and await its correlated response. */
  request<T = JSONValue>(method: string, params: JSONValue | MissingParams = MISSING_PARAMS, options: RequestOptions = {}): Promise<T> {
    if (!method) return Promise.reject(new Error('method cannot be empty'));
    this.ensureStarted();
    if (this.closedFlag) return Promise.reject(this.closedError());
    if (options.signal?.aborted) return Promise.reject(new AbortError());
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    if (timeoutMs <= 0) return Promise.reject(new Error('timeoutMs must be positive'));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const entry: PendingRequest = {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer: null,
        signal: options.signal,
      };
      entry.timer = setTimeout(() => {
        if (this.pending.get(id) !== entry) return;
        this.abandon(id, entry);
        this.scheduleCancellation(id);
        reject(new LSPRequestTimeout(method, id, timeoutMs));
      }, timeoutMs);
      if (options.signal) {
        entry.onAbort = () => {
          if (this.pending.get(id) !== entry) return;
          this.abandon(id, entry);
          this.scheduleCancellation(id);
          reject(new AbortError());
        };
        options.signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.pending.set(id, entry);
      this.write(makeMethodMessage(method, params, id)).catch((error: unknown) => {
        if (this.pending.get(id) !== entry) return;
        this.abandon(id, entry);
        reject(error);
      });
    });
  }

  /** Send a notification; resolves once it has been handed to the pipe. */
  async notify(method: string, params: JSONValue | MissingParams = MISSING_PARAMS): Promise<void> {
    if (!method) throw new Error('method cannot be empty');
    this.ensureStarted();
    if (this.closedFlag) throw this.closedError();
    await this.write(makeMethodMessage(method, params));
  }

  /** Close the transport and fail all pending requests. */
  async close(): Promise<void> {
    if (!this.closedFlag) this.stop(this.terminal ?? new LSPTransportClosed('LSP transport closed'));
    this.detach();
    await new Promise<void>((resolve) => {
      if (this.input.destroyed || this.input.writableEnded) {
        resolve();
        return;
      }
      this.input.end(() => resolve());
      // `end` waits for a drain the dead peer may never give; do not hang on it.
      setTimeout(resolve, 200).unref?.();
    });
  }

  /** Fail the session with an owner-supplied terminal cause (process exit). */
  abort(error: LeanLSPError): void {
    if (this.closedFlag) {
      if (this.terminal instanceof LSPTransportClosed) this.terminal = error;
      return;
    }
    this.stop(error);
  }

  private ensureStarted(): void {
    if (!this.started) this.start();
  }

  private closedError(): LeanLSPError {
    return this.terminal ?? new LSPTransportClosed('LSP transport closed');
  }

  private abandon(id: number, entry: PendingRequest): void {
    if (this.pending.get(id) === entry) this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
  }

  private scheduleCancellation(id: number): void {
    if (this.closedFlag) return;
    // Best effort: a stuck pipe must not delay the caller's timeout error.
    const timer = setTimeout(() => {}, CANCELLATION_SEND_TIMEOUT_MS);
    timer.unref?.();
    this.write(makeMethodMessage('$/cancelRequest', { id })).catch(() => {}).finally(() => clearTimeout(timer));
  }

  private write(message: JsonRpcMessage): Promise<void> {
    let frame: Buffer;
    try {
      frame = encodeMessage(message, this.maxMessageBytes);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.closedFlag) return Promise.reject(this.closedError());
    return new Promise<void>((resolve, reject) => {
      const ok = this.input.write(frame, (error) => {
        if (error) {
          reject(this.terminal ?? new LSPTransportClosed(`failed to write to LSP transport: ${error.message}`));
          return;
        }
        resolve();
      });
      if (!ok && this.input.destroyed) reject(this.closedError());
    });
  }

  private receive(chunk: Buffer): void {
    if (this.closedFlag) return;
    let bodies: Buffer[];
    try {
      bodies = this.parser.feed(chunk);
    } catch (error) {
      this.stop(error instanceof LeanLSPError ? error : new LSPTransportClosed(`unexpected LSP reader failure: ${(error as Error).message}`));
      return;
    }
    for (const body of bodies) {
      if (this.closedFlag) return;
      try {
        this.dispatch(decodeMessage(body));
      } catch (error) {
        this.stop(error instanceof LeanLSPError ? error : new LSPTransportClosed(`unexpected LSP reader failure: ${(error as Error).message}`));
        return;
      }
    }
  }

  private dispatch(message: JsonRpcMessage): void {
    const incoming = classifyMessage(message);
    switch (incoming.kind) {
      case 'notification':
        this.reduceNotification(incoming.method, message.params);
        return;
      case 'request':
        void this.serveInboundRequest(incoming);
        return;
      case 'ignored':
        return;
      case 'response': {
        const entry = this.pending.get(incoming.requestId);
        if (!entry) return;
        this.abandon(incoming.requestId, entry);
        if (incoming.error) entry.reject(incoming.error);
        else entry.resolve(incoming.result);
        return;
      }
      default:
        return;
    }
  }

  private reduceNotification(method: string, params: JSONValue | undefined): void {
    if (method === '$/cancelRequest') {
      const id = params && typeof params === 'object' && !Array.isArray(params) ? params.id : undefined;
      if (typeof id !== 'number' && typeof id !== 'string') throw new LSPProtocolError('$/cancelRequest has an invalid id');
      this.inboundCancelled.add(id);
    }
    if (!this.reducer) return;
    try {
      this.reducer(method, params);
    } catch (error) {
      throw new LSPTransportClosed(`LSP notification reducer failed: ${(error as Error).name}: ${(error as Error).message}`);
    }
  }

  private async serveInboundRequest(item: IncomingRequest): Promise<void> {
    let response: JsonRpcMessage;
    try {
      if (!this.requestHandler) throw new LSPServerError(METHOD_NOT_FOUND, `Method not found: ${item.method}`);
      const result = await this.requestHandler(item.method, item.message.params);
      response = this.inboundCancelled.has(item.requestId)
        ? makeErrorResponse(item.requestId, REQUEST_CANCELLED, 'Request cancelled')
        : { jsonrpc: JSONRPC_VERSION, id: item.requestId, result: result ?? null };
    } catch (error) {
      response =
        error instanceof LSPServerError
          ? makeErrorResponse(item.requestId, error.code, error.serverMessage, error.data === null ? MISSING_PARAMS : error.data)
          : makeErrorResponse(item.requestId, INTERNAL_ERROR, (error as Error).message || (error as Error).name || 'error');
    }
    this.inboundCancelled.delete(item.requestId);
    if (this.closedFlag) return;
    await this.write(response).catch(() => {});
  }

  private stop(error: LeanLSPError): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.terminal = this.terminal ?? error;
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [id, entry] of entries) {
      this.abandon(id, entry);
      entry.reject(this.terminal);
    }
    this.detach();
  }

  private detach(): void {
    this.output.off('data', this.onData);
    this.output.off('end', this.onEnd);
    this.output.off('close', this.onEnd);
    this.output.off('error', this.onStreamError);
    this.input.off('error', this.onWriteError);
    // A stream we stop reading must not keep its data buffered forever.
    this.output.on('error', () => {});
    this.input.on('error', () => {});
  }
}
