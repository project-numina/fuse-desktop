import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { acquireInstanceLock, checkPort, instancePort } from '../../src/main/instance-lock.mjs';
import { parseStandaloneArgs } from '../../src/main/launch-options';

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

describe('per-user instance guard', () => {
  it('shares the runtime identity across modes/data and separates launcher ownership', () => {
    expect(instancePort()).toBe(instancePort('runtime'));
    expect(instancePort('launcher')).toBe(instancePort() + 1);
  });

  it('rejects contenders without releasing the live owner, and permits restart', async () => {
    const port = await freePort();
    const release = await acquireInstanceLock('runtime', port);
    try {
      await expect(acquireInstanceLock('runtime', port)).rejects.toThrow('already running or launching');
      await expect(acquireInstanceLock('runtime', port)).rejects.toThrow('already running or launching');
      await expect(checkPort(port)).rejects.toThrow('unavailable');
    } finally { release(); }
    await new Promise(resolve => setImmediate(resolve));
    const releaseNext = await acquireInstanceLock('runtime', port);
    releaseNext();
  });

  it('recovers after an owner is killed without stale lock cleanup', async () => {
    const port = await freePort();
    const module = fileURLToPath(new URL('../../src/main/instance-lock.mjs', import.meta.url));
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireInstanceLock } from ${JSON.stringify(module)}; await acquireInstanceLock('runtime', ${port}); console.log('ready'); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await once(child.stdout!, 'data');
      await expect(acquireInstanceLock('runtime', port)).rejects.toThrow('already running');
    } finally {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    const release = await acquireInstanceLock('runtime', port);
    release();
  });
});

describe('standalone command line', () => {
  it('uses shared defaults and permits ephemeral test ports explicitly', () => {
    expect(parseStandaloneArgs([], '/renderer')).toMatchObject({ data: expect.stringMatching(/Fuse$/), port: 0 });
    expect(parseStandaloneArgs(['--port', '0', '--renderer', 'none'], '/renderer')).toMatchObject({ port: 0, renderer: null });
  });
  it.each(['--port', '--data', '--token', '--renderer', '--register'])('rejects missing %s values', flag => {
    expect(() => parseStandaloneArgs([flag], '/renderer')).toThrow('requires a value');
  });
  it.each(['-1', '65536', '1.5', 'NaN', '1e3', ''])('rejects invalid port %s', port => {
    expect(() => parseStandaloneArgs(['--port', port], '/renderer')).toThrow();
  });
  it('rejects unknown flags and file data paths', () => {
    expect(() => parseStandaloneArgs(['--wat', 'x'], '/renderer')).toThrow('Unknown option');
    expect(() => parseStandaloneArgs(['--data', 'package.json'], '/renderer')).toThrow('not a directory');
  });
});
