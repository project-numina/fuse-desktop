/**
 * Pure Language Server Protocol framing (`Content-Length: N\r\n\r\n<json>`)
 * and JSON-RPC 2.0 validation, hand-rolled so the client needs no extra
 * dependency. The incremental `FrameParser` copes with headers and bodies
 * arriving split across arbitrary stdout chunks.
 */

import { LSPProtocolError, LSPServerError, type JSONValue } from './errors';

export const HEADER_SEPARATOR = '\r\n\r\n';
export const JSONRPC_VERSION = '2.0';
export const METHOD_NOT_FOUND = -32601;
export const INTERNAL_ERROR = -32603;
export const REQUEST_CANCELLED = -32800;
export const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

/** Sentinel distinguishing an omitted `params` member from JSON null. */
export const MISSING_PARAMS: unique symbol = Symbol('missing params');
export type MissingParams = typeof MISSING_PARAMS;

export type JsonRpcMessage = Record<string, JSONValue>;

export interface IncomingNotification {
  kind: 'notification';
  method: string;
  message: JsonRpcMessage;
}

export interface IncomingRequest {
  kind: 'request';
  method: string;
  requestId: number | string;
  message: JsonRpcMessage;
}

export interface IncomingResponse {
  kind: 'response';
  requestId: number;
  result: JSONValue;
  error: LSPServerError | null;
}

/** A response whose (string) id can never match one of our integer ids. */
export interface IgnoredResponse {
  kind: 'ignored';
}

export type IncomingMessage = IncomingNotification | IncomingRequest | IncomingResponse | IgnoredResponse;

export function makeMethodMessage(method: string, params: JSONValue | MissingParams, requestId?: number): JsonRpcMessage {
  const message: JsonRpcMessage = { jsonrpc: JSONRPC_VERSION, method };
  if (requestId !== undefined) message.id = requestId;
  if (params !== MISSING_PARAMS) message.params = params;
  return message;
}

function rejectNonFinite(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new LSPProtocolError('message is not valid JSON');
  if (Array.isArray(value)) value.forEach(rejectNonFinite);
  else if (value && typeof value === 'object') Object.values(value).forEach(rejectNonFinite);
}

/** Encode one bounded JSON-RPC object as an LSP frame. */
export function encodeMessage(message: JsonRpcMessage, maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES): Buffer {
  rejectNonFinite(message);
  let body: Buffer;
  try {
    body = Buffer.from(JSON.stringify(message), 'utf8');
  } catch (error) {
    throw new LSPProtocolError(`message is not valid JSON: ${(error as Error).message}`);
  }
  if (body.length > maxMessageBytes) throw new LSPProtocolError(`outgoing message exceeds ${maxMessageBytes} bytes`);
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}${HEADER_SEPARATOR}`, 'ascii'), body]);
}

/** Decode and validate one JSON-RPC message body. */
export function decodeMessage(body: Buffer | string): JsonRpcMessage {
  let decoded: unknown;
  try {
    decoded = JSON.parse(typeof body === 'string' ? body : body.toString('utf8'));
  } catch {
    throw new LSPProtocolError('invalid JSON in LSP message');
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new LSPProtocolError('JSON-RPC message must be an object');
  if ((decoded as Record<string, unknown>).jsonrpc !== JSONRPC_VERSION) throw new LSPProtocolError("JSON-RPC version must be '2.0'");
  return decoded as JsonRpcMessage;
}

function parseHeaderFields(headerText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rawLine of headerText.split('\r\n')) {
    const index = rawLine.indexOf(':');
    if (index < 0) throw new LSPProtocolError('malformed LSP header');
    const name = rawLine.slice(0, index).trim().toLowerCase();
    if (!name || name in headers) throw new LSPProtocolError('invalid or duplicate LSP header');
    headers[name] = rawLine.slice(index + 1).trim();
  }
  return headers;
}

function parseContentLength(raw: string | undefined, maximum: number): number {
  if (raw === undefined) throw new LSPProtocolError('missing Content-Length header');
  if (!/^[0-9]+$/.test(raw)) throw new LSPProtocolError('invalid Content-Length header');
  if (raw.length > String(maximum).length) throw new LSPProtocolError(`Content-Length must be between 0 and ${maximum}`);
  const length = Number.parseInt(raw, 10);
  if (length < 0 || length > maximum) throw new LSPProtocolError(`Content-Length must be between 0 and ${maximum}`);
  return length;
}

function validateContentType(contentType: string | undefined): void {
  if (contentType === undefined) return;
  for (const parameter of contentType.toLowerCase().split(';').slice(1)) {
    const [name, ...rest] = parameter.trim().split('=');
    if (name === 'charset' && (rest.length === 0 || !['utf-8', 'utf8'].includes(rest.join('=').trim()))) {
      throw new LSPProtocolError('only UTF-8 LSP messages are supported');
    }
  }
}

/** Validate an LSP header block (including the trailing separator) and return its content length. */
export function parseHeaders(headerBlock: Buffer | string, maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES): number {
  const bytes = typeof headerBlock === 'string' ? Buffer.from(headerBlock, 'latin1') : headerBlock;
  const text = bytes.subarray(0, bytes.length - HEADER_SEPARATOR.length);
  if (text.some((byte) => byte > 0x7f)) throw new LSPProtocolError('LSP headers must be ASCII');
  const headers = parseHeaderFields(text.toString('ascii'));
  const length = parseContentLength(headers['content-length'], maxMessageBytes);
  validateContentType(headers['content-type']);
  return length;
}

export function isValidId(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isInteger(value)) || typeof value === 'string';
}

/** Validate and normalize a JSON-RPC error object. */
export function normalizeServerError(value: JSONValue | undefined): LSPServerError {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LSPProtocolError('JSON-RPC error must be an object');
  const { code, message, data } = value as Record<string, JSONValue>;
  if (typeof code !== 'number' || !Number.isInteger(code)) throw new LSPProtocolError('JSON-RPC error code must be an integer');
  if (typeof message !== 'string') throw new LSPProtocolError('JSON-RPC error message must be a string');
  return new LSPServerError(code, message, data ?? null);
}

/** Classify an inbound message as notification, server request, response, or ignored. */
export function classifyMessage(message: JsonRpcMessage): IncomingMessage {
  const method = message.method;
  const id = message.id;
  if (typeof method === 'string') {
    if (!('id' in message)) return { kind: 'notification', method, message };
    if (isValidId(id)) return { kind: 'request', method, requestId: id, message };
    throw new LSPProtocolError('JSON-RPC request has an invalid id');
  }
  if (!('id' in message)) throw new LSPProtocolError('invalid JSON-RPC response');
  if (id === null) {
    if ('error' in message) {
      const error = normalizeServerError(message.error);
      throw new LSPProtocolError(`uncorrelated JSON-RPC error ${error.code}: ${error.serverMessage}`);
    }
    throw new LSPProtocolError('JSON-RPC response has a null id');
  }
  if (!isValidId(id)) throw new LSPProtocolError('invalid JSON-RPC response');
  if (typeof id !== 'number') return { kind: 'ignored' };
  const hasResult = 'result' in message;
  const hasError = 'error' in message;
  if (hasResult === hasError) throw new LSPProtocolError('JSON-RPC response must contain exactly one of result or error');
  return { kind: 'response', requestId: id, result: message.result ?? null, error: hasError ? normalizeServerError(message.error) : null };
}

export function makeErrorResponse(id: number | string, code: number, message: string, data: JSONValue | MissingParams = MISSING_PARAMS): JsonRpcMessage {
  const error: JsonRpcMessage = { code, message };
  if (data !== MISSING_PARAMS) error.data = data;
  return { jsonrpc: JSONRPC_VERSION, id, error };
}

/**
 * Incremental frame splitter: feed it stdout chunks, get whole message
 * bodies back. Enforces the header/body bounds before buffering a body.
 */
export class FrameParser {
  private buffer: Buffer = Buffer.alloc(0);
  private expectedLength: number | null = null;

  constructor(private readonly maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES) {}

  /** Append bytes and return every complete body now available. */
  feed(chunk: Buffer): Buffer[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const bodies: Buffer[] = [];
    for (;;) {
      if (this.expectedLength === null) {
        const separator = this.buffer.indexOf(HEADER_SEPARATOR, 0, 'ascii');
        if (separator < 0) {
          // Guard against an endless header: no real header is this long.
          if (this.buffer.length > 64 * 1024) throw new LSPProtocolError('LSP header exceeds stream limit');
          break;
        }
        const headerBlock = this.buffer.subarray(0, separator + HEADER_SEPARATOR.length);
        this.expectedLength = parseHeaders(headerBlock, this.maxMessageBytes);
        this.buffer = this.buffer.subarray(separator + HEADER_SEPARATOR.length);
      }
      if (this.buffer.length < this.expectedLength) break;
      bodies.push(this.buffer.subarray(0, this.expectedLength));
      this.buffer = this.buffer.subarray(this.expectedLength);
      this.expectedLength = null;
    }
    return bodies;
  }

  /** Bytes of a message still being received (for EOF diagnostics). */
  get pendingBytes(): number {
    return this.buffer.length;
  }
}
