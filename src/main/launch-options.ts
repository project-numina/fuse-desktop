import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultDataPath, parsePort } from './instance-lock.mjs';

export function dataPath(value = process.env.FUSE_DATA_DIR ?? defaultDataPath()): string {
  if (!value.trim()) throw new Error('Data directory must not be empty.');
  const path = resolve(value);
  if (existsSync(path) && !statSync(path).isDirectory()) throw new Error(`Data path is not a directory: ${path}`);
  return path;
}

export function parseStandaloneArgs(argv: string[], renderer: string) {
  const args = { data: dataPath(), port: 0, token: null as string | null, renderer: renderer as string | null, register: [] as string[] };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!['--data', '--port', '--token', '--renderer', '--register'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = argv[i + 1];
    if (!value?.trim() || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    switch (flag) {
      case '--data': args.data = dataPath(value); break;
      case '--port': args.port = parsePort(value, true); break;
      case '--token': args.token = value; break;
      case '--renderer': args.renderer = value === 'none' ? null : resolve(value); break;
      case '--register': args.register.push(resolve(value)); break;
    }
  }
  return args;
}
