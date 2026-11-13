import process from 'node:process';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { acquireInstanceLock, checkPort, parsePort } from '../src/main/instance-lock.mjs';

let child;
function run(command, args) {
  return new Promise((resolveRun, reject) => {
    child = spawn(command, args, { stdio: 'inherit', env: process.env, detached: process.platform !== 'win32' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      if (code === 0) resolveRun();
      else reject(new Error(`${command} stopped (${signal || `exit ${code}`}).`));
    });
  });
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => {
  if (!child) process.exit(1);
  try {
    // npm and electron-vite have descendants; signal their POSIX group together.
    // SIGHUP becomes a graceful termination for runtimes without a HUP handler.
    const forwarded = signal === 'SIGHUP' ? 'SIGTERM' : signal;
    if (process.platform === 'win32') child.kill(forwarded);
    else process.kill(-child.pid, forwarded);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(`[fuse] could not stop child: ${error.message}`);
  }
});

try {
  const [mode, ...argv] = process.argv.slice(2);
  if (!['app', 'web'].includes(mode)) throw new Error('Usage: node scripts/launch.mjs app|web [--port PORT] [--data DIR]');
  let port = 9988;
  let data;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!value?.trim() || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    if (flag === '--port' && mode === 'web') port = parsePort(value);
    else if (flag === '--data') data = resolve(value);
    else throw new Error(`Unknown option ${flag} for ${mode}.`);
  }
  if (data && existsSync(data) && !statSync(data).isDirectory()) throw new Error(`Data path is not a directory: ${data}`);
  await acquireInstanceLock('launcher');
  // Independent guards: runtime owns its lock itself, so no inherited lock can
  // accidentally authorize a second child. Release this probe before starting it.
  const releaseProbe = await acquireInstanceLock();
  releaseProbe();
  if (mode === 'web') await checkPort(port);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const stamp = 'node_modules/.fuse-dependencies';
  if (!existsSync(stamp) || ['package.json', 'package-lock.json'].some(path => statSync(path).mtimeMs > statSync(stamp).mtimeMs)) {
    await run(npm, ['ci']);
    mkdirSync('node_modules', { recursive: true });
    writeFileSync(stamp, '');
  }
  if (data) process.env.FUSE_DATA_DIR = data;
  if (mode === 'app') await run(npm, ['run', 'dev']);
  else {
    await run(npm, ['run', 'build']);
    await run(process.execPath, ['out/main/standalone.js', '--port', String(port), ...(data ? ['--data', data] : [])]);
  }
} catch (error) {
  console.error(`[fuse] ${error.message}`);
  process.exitCode = 1;
}
