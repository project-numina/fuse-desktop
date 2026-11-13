import process from 'node:process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

/** Shared with the dependency-free Make launcher. Kernel ownership survives no crashes. */
export function instancePort(kind = 'runtime') {
  const identity = String(process.getuid?.() ?? userInfo().username);
  const slot = createHash('sha256').update(identity).digest().readUInt16BE(0) % 10000;
  return 40000 + slot * 2 + (kind === 'launcher' ? 1 : 0);
}

export async function acquireInstanceLock(kind = 'runtime', port = instancePort(kind)) {
  const server = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', error => {
      const detail = error.code === 'EADDRINUSE'
        ? 'Fuse is already running or launching for this user (desktop or web). Close it before starting another instance.'
        : `Could not reserve the Fuse instance lock: ${error.message}`;
      reject(new Error(`${detail} [127.0.0.1:${port}]`));
    });
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  server.unref();
  return () => server.close();
}

export function defaultDataPath() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Fuse');
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Fuse');
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Fuse');
}

export function parsePort(value, allowZero = false) {
  if (!/^\d+$/.test(value ?? '')) throw new Error(`Invalid port ${JSON.stringify(value)}; use an integer from ${allowZero ? 0 : 1} to 65535.`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < (allowZero ? 0 : 1) || port > 65535) throw new Error(`Invalid port ${JSON.stringify(value)}; use an integer from ${allowZero ? 0 : 1} to 65535.`);
  return port;
}

/** A preflight only; the actual HTTP bind remains authoritative. */
export async function checkPort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(new Error(`Cannot start Fuse: port ${port} on 127.0.0.1 is unavailable (${error.code}). Choose another PORT/--port or stop the process using it.`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  await new Promise(resolve => server.close(resolve));
}
