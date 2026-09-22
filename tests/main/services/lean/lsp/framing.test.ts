import { describe, expect, it } from 'vitest';
import { LSPProtocolError } from '@main/services/lean/lsp/errors';
import { classifyMessage, decodeMessage, encodeMessage, FrameParser, isValidId, makeErrorResponse, makeMethodMessage, MISSING_PARAMS, normalizeServerError, parseHeaders } from '@main/services/lean/lsp/framing';

describe('encodeMessage', () => {
  it('uses the UTF-8 byte length and compact JSON', () => {
    const message = { jsonrpc: '2.0', method: 'echo', params: 'λ' };
    const frame = encodeMessage(message, 1024);
    const separator = frame.indexOf('\r\n\r\n');
    const header = frame.subarray(0, separator).toString('ascii');
    const body = frame.subarray(separator + 4);
    expect(header).toBe(`Content-Length: ${body.length}`);
    expect(body.toString('utf8')).toBe(JSON.stringify(message));
    expect(body.length).toBe(Buffer.byteLength(JSON.stringify(message)));
  });

  it('rejects non-JSON numbers', () => {
    expect(() => encodeMessage({ jsonrpc: '2.0', result: Number.NaN }, 1024)).toThrow(/valid JSON/);
    expect(() => encodeMessage({ jsonrpc: '2.0', result: Number.POSITIVE_INFINITY }, 1024)).toThrow(/valid JSON/);
  });

  it('enforces the body size bound', () => {
    expect(() => encodeMessage({ jsonrpc: '2.0' }, 2)).toThrow(/exceeds 2 bytes/);
  });
});

describe('parseHeaders', () => {
  it.each([
    ['Broken\r\n\r\n', /malformed/],
    [': value\r\n\r\n', /invalid or duplicate/],
    ['Content-Length: 1\r\ncontent-length: 1\r\n\r\n', /invalid or duplicate/],
    ['Content-Type: application/json\r\n\r\n', /missing Content-Length/],
    ['Content-Length: 3.14\r\n\r\n', /invalid Content-Length/],
    ['Content-Length: 999\r\n\r\n', /must be between/],
    ['Content-Length: 1\r\nContent-Type: application/vscode-jsonrpc; charset=latin-1\r\n\r\n', /UTF-8/],
  ])('rejects %j', (headers, message) => {
    expect(() => parseHeaders(headers, 100)).toThrow(message);
  });

  it('rejects non-ASCII names', () => {
    expect(() => parseHeaders(Buffer.from('Content-Léngth: 1\r\n\r\n', 'utf8'), 100)).toThrow(/ASCII/);
  });

  it.each(['utf-8', 'utf8'])('accepts charset %s', (charset) => {
    expect(parseHeaders(`Content-Length: 1\r\nContent-Type: application/vscode-jsonrpc; charset=${charset}; x=y\r\n\r\n`, 100)).toBe(1);
  });
});

describe('decodeMessage', () => {
  it.each([
    ['[]', /must be an object/],
    ['{"jsonrpc":"1.0"}', /version/],
    ['{"jsonrpc":"2.0","result":NaN}', /invalid JSON/],
    ['￿{', /invalid JSON/],
  ])('rejects %j', (payload, message) => {
    expect(() => decodeMessage(payload)).toThrow(message);
  });
});

describe('method messages', () => {
  it('distinguishes omitted params from null', () => {
    expect(makeMethodMessage('shutdown', MISSING_PARAMS, 7)).toEqual({ jsonrpc: '2.0', method: 'shutdown', id: 7 });
    expect(makeMethodMessage('shutdown', null, 7)).toEqual({ jsonrpc: '2.0', method: 'shutdown', id: 7, params: null });
    expect(makeMethodMessage('exit', MISSING_PARAMS)).toEqual({ jsonrpc: '2.0', method: 'exit' });
  });

  it('builds error responses with optional data', () => {
    expect(makeErrorResponse(1, -32601, 'nope')).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'nope' } });
    expect(makeErrorResponse('x', 1, 'm', { a: 1 })).toEqual({ jsonrpc: '2.0', id: 'x', error: { code: 1, message: 'm', data: { a: 1 } } });
  });
});

describe('classifyMessage', () => {
  it('classifies notifications, requests, responses and ignored responses', () => {
    expect(classifyMessage({ jsonrpc: '2.0', method: 'n' })).toMatchObject({ kind: 'notification', method: 'n' });
    expect(classifyMessage({ jsonrpc: '2.0', method: 'r', id: 'srv' })).toMatchObject({ kind: 'request', requestId: 'srv' });
    expect(classifyMessage({ jsonrpc: '2.0', id: 3, result: 1 })).toEqual({ kind: 'response', requestId: 3, result: 1, error: null });
    expect(classifyMessage({ jsonrpc: '2.0', id: 'str', result: 1 })).toEqual({ kind: 'ignored' });
    const errored = classifyMessage({ jsonrpc: '2.0', id: 4, error: { code: -1, message: 'bad', data: 5 } });
    expect(errored.kind).toBe('response');
    if (errored.kind === 'response') {
      expect(errored.error?.code).toBe(-1);
      expect(errored.error?.serverMessage).toBe('bad');
      expect(errored.error?.data).toBe(5);
    }
  });

  it('rejects malformed shapes', () => {
    expect(() => classifyMessage({ jsonrpc: '2.0', method: 'r', id: true })).toThrow(LSPProtocolError);
    expect(() => classifyMessage({ jsonrpc: '2.0', result: 1 })).toThrow(/invalid JSON-RPC response/);
    expect(() => classifyMessage({ jsonrpc: '2.0', id: null, error: { code: 1, message: 'x' } })).toThrow(/uncorrelated JSON-RPC error 1: x/);
    expect(() => classifyMessage({ jsonrpc: '2.0', id: null, result: 1 })).toThrow(/null id/);
    expect(() => classifyMessage({ jsonrpc: '2.0', id: 1, result: 1, error: { code: 1, message: 'x' } })).toThrow(/exactly one/);
    expect(() => classifyMessage({ jsonrpc: '2.0', id: 1 })).toThrow(/exactly one/);
    expect(() => normalizeServerError({ code: 'x', message: 'm' })).toThrow(/code must be an integer/);
    expect(() => normalizeServerError({ code: 1, message: 2 })).toThrow(/message must be a string/);
    expect(isValidId(true)).toBe(false);
    expect(isValidId(1.5)).toBe(false);
    expect(isValidId('a')).toBe(true);
  });
});

describe('FrameParser', () => {
  it('reassembles frames split at arbitrary byte boundaries', () => {
    const frames = [encodeMessage({ jsonrpc: '2.0', method: 'a', params: 'λ' }), encodeMessage({ jsonrpc: '2.0', id: 1, result: [1, 2, 3] })];
    const stream = Buffer.concat(frames);
    for (const chunkSize of [1, 2, 3, 7, 64, stream.length]) {
      const parser = new FrameParser();
      const bodies: string[] = [];
      for (let offset = 0; offset < stream.length; offset += chunkSize) {
        for (const body of parser.feed(stream.subarray(offset, offset + chunkSize))) bodies.push(body.toString('utf8'));
      }
      expect(bodies).toEqual([JSON.stringify({ jsonrpc: '2.0', method: 'a', params: 'λ' }), JSON.stringify({ jsonrpc: '2.0', id: 1, result: [1, 2, 3] })]);
      expect(parser.pendingBytes).toBe(0);
    }
  });

  it('reports a partially received message and rejects oversized bodies', () => {
    const parser = new FrameParser(10);
    expect(parser.feed(Buffer.from('Content-Length: 5\r\n\r\nab'))).toEqual([]);
    expect(parser.pendingBytes).toBe(2);
    expect(() => new FrameParser(10).feed(Buffer.from('Content-Length: 11\r\n\r\n'))).toThrow(/must be between/);
  });
});
