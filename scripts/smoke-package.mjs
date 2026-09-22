import { spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercise the actual package, including external runtime dependencies and preload.
const release = resolve('release');
const candidates = process.platform === 'darwin'
  ? readdirSync(release).filter(name => name.startsWith('mac')).map(name => join(release, name, 'Fuse.app/Contents/MacOS/Fuse'))
  : process.platform === 'win32'
    ? [join(release, 'win-unpacked/Fuse.exe')]
    : [join(release, 'linux-unpacked/fuse-desktop'), join(release, 'linux-unpacked/Fuse')];
const executable = candidates.find(existsSync);
if (!executable) throw new Error('Packaged executable was not found.');
const directory = mkdtempSync(join(tmpdir(), 'fuse-package-smoke-'));
const screenshot = join(directory, 'smoke.png');
const args = [`--user-data-dir=${join(directory, 'data')}`];
if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--ozone-platform=x11');
const child = spawn(executable, args, {
  env: { ...process.env, FUSE_SCREENSHOT: screenshot },
  stdio: 'inherit',
});
const timeout = setTimeout(() => {
  child.kill();
  console.error('Packaged application did not complete its smoke test within 90 seconds.');
  process.exit(1);
}, 90_000);
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.on('exit', code => {
  clearTimeout(timeout);
  if (code !== 0 || !existsSync(screenshot) || statSync(screenshot).size < 1000) {
    console.error('Packaged app failed to launch, render, capture, and quit cleanly.');
    process.exitCode = 1;
  } else console.log('Packaged app launched, rendered, and quit successfully.');
});
