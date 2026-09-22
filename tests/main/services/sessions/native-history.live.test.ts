import { describe, expect, it } from 'vitest';
import { ProviderNativeHistory } from '@main/services/sessions/native-history';

// Opt-in, read-only verification. Never starts an agent turn or alters provider sessions.
const directory = process.env.FUSE_NATIVE_HISTORY_FOLDER;
describe.skipIf(!directory)('installed native history readers', () => {
  it('lists folder sessions and reads one chat per installed provider', async () => {
    const reader = new ProviderNativeHistory(() => process.env.FUSE_CODEX_PATH || 'codex');
    const result = await reader.list([directory!]);
    expect(result.errors).toEqual([]);
    for (const provider of ['claude', 'codex'] as const) {
      const session = result.sessions.find((entry) => entry.provider === provider);
      expect(session, `Expected a ${provider} session in the chosen test folder`).toBeDefined();
      const messages = await reader.read(session!);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.every((row) => typeof row.content === 'string')).toBe(true);
    }
  }, 60_000);
});
