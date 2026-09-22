/** Exceptions raised by the Lean LSP client. */

import { formatSeconds } from '../async';

export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };

export class LeanLSPError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class LeanProcessError extends LeanLSPError {}

/** The `lake serve` process exited unexpectedly. */
export class LeanProcessExited extends LeanProcessError {
  constructor(
    readonly returncode: number | null,
    readonly stderrTail = '',
  ) {
    super(stderrTail ? `Lean language server exited with code ${returncode}. Stderr tail:\n${stderrTail}` : `Lean language server exited with code ${returncode}`);
  }
}

export class LeanInitializationError extends LeanLSPError {}

/** The peer sent an invalid LSP or JSON-RPC message. */
export class LSPProtocolError extends LeanLSPError {}

/** An operation needed a live transport. */
export class LSPTransportClosed extends LeanLSPError {}

/**
 * A request exceeded its timeout. The message is load-bearing: the API layer
 * maps this exact text to the `lean_query_retry` 409 the frontend retries on.
 */
export class LSPRequestTimeout extends LeanLSPError {
  constructor(
    readonly method: string,
    readonly requestId: number,
    readonly timeoutMs: number,
  ) {
    super(`LSP request '${method}' (id ${requestId}) timed out after ${formatSeconds(timeoutMs)}s`);
  }
}

/** An error response returned by the language server. */
export class LSPServerError extends LeanLSPError {
  constructor(
    readonly code: number,
    readonly serverMessage: string,
    readonly data: JSONValue = null,
  ) {
    super(`LSP server error ${code}: ${serverMessage}`);
  }
}

export class DocumentNotOpen extends LeanLSPError {}
