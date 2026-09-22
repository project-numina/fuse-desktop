import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { argsAreShellSafe, cmdShimTarget, codexNativeBinary, findOnPath, quoteForCmd, resolveCliCommand } from '@main/agents/spawn';

/** The text npm's cmd-shim writes for a JavaScript bin (`%dp0%` is the shim's folder). */
function npmJsShim(target: string): string {
  return [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`,
    '',
  ].join('\r\n');
}

/** The shim for a bin that is not JavaScript (Claude Code ships a native binary). */
function npmExeShim(target: string): string {
  return `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%dp0%\\${target}"   %*\r\n`;
}

const WIN_ARGS = ['exec', '-c', 'mcp_servers.fuse.args=["C:\\\\Users\\\\Justin Asher\\\\mcp-bootstrap.cjs"]', '--mcp-config', 'C:\\Users\\Justin Asher\\mcp.json'];

describe('resolveCliCommand', () => {
  let prefix: string;

  beforeEach(() => {
    prefix = realpathSync(mkdtempSync(join(tmpdir(), 'fuse-spawn-')));
  });

  afterEach(() => {
    rmSync(prefix, { recursive: true, force: true });
  });

  function file(path: string, content = ''): string {
    const full = join(prefix, ...path.split('/'));
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
    return full;
  }

  it('runs the native Codex binary behind the npm .cmd shim on Windows, without a shell', () => {
    const shim = file('codex.cmd', npmJsShim('node_modules\\@openai\\codex\\bin\\codex.js'));
    file('node_modules/@openai/codex/bin/codex.js', '// wrapper');
    const native = file('node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
    const resolved = resolveCliCommand(shim, WIN_ARGS, { platform: 'win32', arch: 'x64', env: {} });
    expect(resolved).toEqual({
      file: native,
      args: WIN_ARGS,
      env: { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: join(prefix, 'node_modules', '@openai', 'codex') },
      shell: false,
    });
  });

  it('runs a native bin target (Claude Code) directly and finds bare names on the Windows PATH', () => {
    file('claude.cmd', npmExeShim('node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'));
    const exe = file('node_modules/@anthropic-ai/claude-code/bin/claude.exe');
    const env = { Path: `C:\\Windows;${prefix}` };
    expect(findOnPath('claude', { platform: 'win32', env })).toBe(join(prefix, 'claude.cmd'));
    const resolved = resolveCliCommand('claude', ['-p', '--system-prompt-file', 'C:\\Users\\Justin Asher\\system.md'], { platform: 'win32', env });
    expect(resolved).toEqual({ file: exe, args: ['-p', '--system-prompt-file', 'C:\\Users\\Justin Asher\\system.md'], env: {}, shell: false });
  });

  it('runs a JavaScript bin through node.exe next to the shim, else through the app binary in Node mode', () => {
    const shim = file('foo.cmd', npmJsShim('node_modules\\foo\\cli.js'));
    const cli = file('node_modules/foo/cli.js', '#!/usr/bin/env node');
    const viaApp = resolveCliCommand(shim, ['--version'], { platform: 'win32', env: { Path: 'C:\\Windows' }, execPath: 'C:\\Fuse\\Fuse.exe' });
    expect(viaApp).toEqual({ file: 'C:\\Fuse\\Fuse.exe', args: [cli, '--version'], env: { ELECTRON_RUN_AS_NODE: '1' }, shell: false });
    const node = file('node.exe');
    const viaNode = resolveCliCommand(shim, ['--version'], { platform: 'win32', env: {}, execPath: 'C:\\Fuse\\Fuse.exe' });
    expect(viaNode).toEqual({ file: node, args: [cli, '--version'], env: {}, shell: false });
  });

  it('falls back to a shell with quoted arguments for a script that is not an npm shim', () => {
    const shim = file('custom.cmd', '@echo off\r\nsomething %*\r\n');
    const resolved = resolveCliCommand(shim, ['a b', 'x="y z"'], { platform: 'win32', env: {} });
    expect(resolved.shell).toBe(true);
    expect(resolved.file).toBe(shim);
    expect(resolved.args).toEqual(['^"a b^"', '^"x=\\^"y z\\^"^"']);
  });

  it('resolves the Codex symlink to the native binary on POSIX and leaves other commands alone', () => {
    const wrapper = file('lib/node_modules/@openai/codex/bin/codex.js', '// wrapper');
    const native = file(`lib/node_modules/@openai/codex/node_modules/@openai/codex-${process.platform}-${process.arch}/vendor/${
      process.platform === 'darwin' ? (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin') : process.arch === 'arm64' ? 'aarch64-unknown-linux-musl' : 'x86_64-unknown-linux-musl'
    }/bin/codex`);
    mkdirSync(join(prefix, 'bin'), { recursive: true });
    symlinkSync(wrapper, join(prefix, 'bin', 'codex'));
    if (process.platform === 'win32') return;
    const resolved = resolveCliCommand('codex', ['exec', '-'], { platform: process.platform, env: { PATH: join(prefix, 'bin') } });
    expect(resolved.file).toBe(native);
    expect(resolved.args).toEqual(['exec', '-']);
    expect(resolved.env).toEqual({ CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: join(prefix, 'lib', 'node_modules', '@openai', 'codex') });
    expect(resolved.shell).toBe(false);
    // A plain executable is run as is; an unknown name is left for spawn to report.
    const plain = file('bin/claude', '#!/bin/sh');
    expect(resolveCliCommand('claude', ['-p'], { platform: process.platform, env: { PATH: join(prefix, 'bin') } })).toEqual({ file: plain, args: ['-p'], env: {}, shell: false });
    expect(resolveCliCommand('nope', ['-p'], { platform: process.platform, env: { PATH: join(prefix, 'bin') } })).toEqual({ file: 'nope', args: ['-p'], env: {}, shell: false });
  });

  it('reads shim targets and knows the Codex wrapper layout', () => {
    const shim = file('codex.cmd', npmJsShim('node_modules\\@openai\\codex\\bin\\codex.js'));
    expect(cmdShimTarget(shim)).toBe(join(prefix, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
    expect(cmdShimTarget(join(prefix, 'missing.cmd'))).toBeNull();
    expect(codexNativeBinary('/x/node_modules/other/bin/codex.js', { platform: 'linux', arch: 'x64' })).toBeNull();
  });
});

describe('quoteForCmd', () => {
  it('quotes for cmd.exe and the C runtime', () => {
    expect(quoteForCmd('')).toBe('""');
    expect(quoteForCmd('plain')).toBe('^"plain^"');
    expect(quoteForCmd('C:\\Users\\Justin Asher\\')).toBe('^"C:\\Users\\Justin Asher\\\\^"');
    expect(quoteForCmd('{"a":"b"}')).toBe('^"{\\^"a\\^":\\^"b\\^"}^"');
    expect(argsAreShellSafe(['exec', '--json', 'approval_policy="never"'])).toBe(true);
    expect(argsAreShellSafe(['{"mcpServers":{}}'])).toBe(false);
  });
});
