import { spawnCli, killCli } from '../../agents/spawn';
import { StringDecoder } from 'node:string_decoder';

/** Read-only app-server connection. Never starts/resumes a thread or sends a turn. */
export async function codexHistoryRequest(executable: string, method: 'thread/list' | 'thread/read', params: Record<string, unknown>): Promise<unknown> {
  const child = spawnCli(executable || 'codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  return new Promise((resolve, reject) => {
    let finished = false;
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    const timer = setTimeout(() => finish(new Error('Codex history timed out. Check the Codex CLI in Settings → Agents.')), 15_000);
    const finish = (error: Error | null, value?: unknown): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdin?.end();
      killCli(child, 'SIGTERM');
      const force = setTimeout(() => { if (child.exitCode === null) killCli(child, 'SIGKILL'); }, 1000);
      force.unref();
      child.once('exit', () => clearTimeout(force));
      if (error) reject(error); else resolve(value);
    };
    const send = (message: unknown): void => { child.stdin?.write(`${JSON.stringify(message)}\n`); };
    child.on('error', (error) => finish(error));
    child.stdin?.on('error', (error) => finish(error));
    child.stderr?.resume(); // Drain, but never leak local paths or credentials into UI errors.
    child.once('exit', () => finish(new Error('Codex history is unavailable. Check the Codex CLI in Settings → Agents.')));
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      if (buffer.length > 64 * 1024 * 1024) { finish(new Error('This Codex history response is too large to display.')); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: { id?: number; error?: unknown; result?: unknown };
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== 0 && message.id !== 1) continue;
        if (message.error) { finish(new Error('The installed Codex CLI could not read its history. Try updating it.')); return; }
        if (message.id === 0) {
          send({ method: 'initialized', params: {} });
          send({ id: 1, method, params });
        } else { finish(null, message.result); return; }
      }
    });
    send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'numina_fuse_history', title: 'Fuse History', version: '0.1.0' } } });
  });
}
