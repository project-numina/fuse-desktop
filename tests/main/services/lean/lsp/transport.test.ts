import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { sleep } from '@main/services/lean/async';
import { LSPRequestTimeout, LSPServerError, LSPTransportClosed, LeanProcessExited, type JSONValue } from '@main/services/lean/lsp/errors';
import { decodeMessage, encodeMessage, FrameParser, type JsonRpcMessage } from '@main/services/lean/lsp/framing';
import { LspTransport, type TransportOptions } from '@main/services/lean/lsp/transport';

/** A fake server: what the client writes shows up in `received`; `send` answers. */
function harness(options: TransportOptions = {}) {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const received: JsonRpcMessage[] = [];
  const parser = new FrameParser();
  const waiters: Array<() => void> = [];
  toServer.on('data', (chunk: Buffer) => {
    for (const body of parser.feed(chunk)) {
      received.push(decodeMessage(body));
      for (const wake of waiters.splice(0)) wake();
    }
  });
  const send = (message: JsonRpcMessage): void => {
    fromServer.write(encodeMessage(message));
  };
  const nextMessage = async (): Promise<JsonRpcMessage> => {
    if (received.length) return received.shift() as JsonRpcMessage;
    await new Promise<void>((resolve) => waiters.push(resolve));
    return received.shift() as JsonRpcMessage;
  };
  const transport = new LspTransport(toServer, fromServer, options);
  return { transport, send, nextMessage, received, fromServer, toServer };
}

describe('LspTransport', () => {
  it('correlates responses with requests, out of order and across fragmented frames', async () => {
    const h = harness();
    const first = h.transport.request('a', { x: 1 });
    const second = h.transport.request('b', null);
    const requestA = await h.nextMessage();
    const requestB = await h.nextMessage();
    expect(requestA).toEqual({ jsonrpc: '2.0', method: 'a', id: 0, params: { x: 1 } });
    expect(requestB).toEqual({ jsonrpc: '2.0', method: 'b', id: 1, params: null });
    const frame = encodeMessage({ jsonrpc: '2.0', id: 1, result: 'B' });
    for (const byte of frame) h.fromServer.write(Buffer.from([byte]));
    h.send({ jsonrpc: '2.0', id: 0, result: 'A' });
    expect(await second).toBe('B');
    expect(await first).toBe('A');
    await h.transport.close();
  });

  it('turns error responses into LSPServerError', async () => {
    const h = harness();
    const pending = h.transport.request('bad');
    const request = await h.nextMessage();
    h.send({ jsonrpc: '2.0', id: request.id as number, error: { code: -32602, message: 'invalid', data: { received: null } } });
    await expect(pending).rejects.toMatchObject({ code: -32602, serverMessage: 'invalid' });
    await expect(pending).rejects.toBeInstanceOf(LSPServerError);
    await h.transport.close();
  });

  it('runs the notification reducer synchronously in ingress order', async () => {
    const seen: Array<[string, JSONValue | undefined]> = [];
    const h = harness({ notificationReducer: (method, params) => seen.push([method, params]) });
    h.transport.start();
    const pending = h.transport.request('x');
    const request = await h.nextMessage();
    h.fromServer.write(Buffer.concat([
      encodeMessage({ jsonrpc: '2.0', method: 'one', params: 1 }),
      encodeMessage({ jsonrpc: '2.0', method: 'two' }),
      encodeMessage({ jsonrpc: '2.0', id: request.id as number, result: 'done' }),
    ]));
    expect(await pending).toBe('done');
    expect(seen).toEqual([['one', 1], ['two', undefined]]);
    await h.transport.close();
  });

  it('answers server requests through the handler and rejects unknown methods', async () => {
    const h = harness({
      requestHandler: (method) => {
        if (method === 'client/registerCapability') return null;
        throw new LSPServerError(-32601, `Method not found: ${method}`);
      },
    });
    h.transport.start();
    h.send({ jsonrpc: '2.0', id: 'srv-1', method: 'client/registerCapability', params: {} });
    expect(await h.nextMessage()).toEqual({ jsonrpc: '2.0', id: 'srv-1', result: null });
    h.send({ jsonrpc: '2.0', id: 'srv-2', method: 'workspace/other', params: {} });
    expect(await h.nextMessage()).toEqual({ jsonrpc: '2.0', id: 'srv-2', error: { code: -32601, message: 'Method not found: workspace/other' } });
    await h.transport.close();
  });

  it('answers -32601 without a handler', async () => {
    const h = harness();
    h.transport.start();
    h.send({ jsonrpc: '2.0', id: 9, method: 'workspace/configuration' });
    expect(await h.nextMessage()).toEqual({ jsonrpc: '2.0', id: 9, error: { code: -32601, message: 'Method not found: workspace/configuration' } });
    await h.transport.close();
  });

  it('times out with the exact retry message and sends $/cancelRequest', async () => {
    const h = harness();
    const pending = h.transport.request('slow', null, { timeoutMs: 30 });
    const request = await h.nextMessage();
    await expect(pending).rejects.toBeInstanceOf(LSPRequestTimeout);
    await expect(pending).rejects.toThrow(`LSP request 'slow' (id ${request.id}) timed out after 0.03s`);
    expect(await h.nextMessage()).toEqual({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: request.id } });
    // A late response for the abandoned id is ignored.
    h.send({ jsonrpc: '2.0', id: request.id as number, result: 'late' });
    await sleep(5);
    await h.transport.close();
  });

  it('cancels on an abort signal', async () => {
    const h = harness();
    const controller = new AbortController();
    const pending = h.transport.request('slow', null, { signal: controller.signal });
    const request = await h.nextMessage();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(await h.nextMessage()).toEqual({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: request.id } });
    await expect(h.transport.request('x', null, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await h.transport.close();
  });

  it('fails pending requests when the server closes stdout', async () => {
    const h = harness();
    const pending = h.transport.request('x');
    await h.nextMessage();
    h.fromServer.end();
    await expect(pending).rejects.toBeInstanceOf(LSPTransportClosed);
    await expect(pending).rejects.toThrow(/closed stdout/);
    expect(h.transport.closed).toBe(true);
    await expect(h.transport.request('y')).rejects.toBeInstanceOf(LSPTransportClosed);
  });

  it('reports a process exit as the terminal error once aborted', async () => {
    const h = harness();
    const pending = h.transport.request('x');
    await h.nextMessage();
    h.transport.abort(new LeanProcessExited(1, 'boom'));
    await expect(pending).rejects.toBeInstanceOf(LeanProcessExited);
    await expect(h.transport.notify('n')).rejects.toBeInstanceOf(LeanProcessExited);
  });

  it('closes on a protocol error from the peer', async () => {
    const h = harness();
    const pending = h.transport.request('x');
    await h.nextMessage();
    h.fromServer.write(Buffer.from('Content-Length: 2\r\n\r\n[]'));
    await expect(pending).rejects.toThrow(/must be an object/);
  });

  it('notify resolves once written and rejects on empty methods', async () => {
    const h = harness();
    await h.transport.notify('initialized', {});
    expect(await h.nextMessage()).toEqual({ jsonrpc: '2.0', method: 'initialized', params: {} });
    await expect(h.transport.notify('')).rejects.toThrow(/empty/);
    await h.transport.close();
  });
});
