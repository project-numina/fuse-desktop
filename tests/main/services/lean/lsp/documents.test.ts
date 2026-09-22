import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentStore } from '@main/services/lean/lsp/documents';

describe('DocumentStore root canonicalization', () => {
  it('accepts documents under a symlinked project root without allowing escapes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fuse-documents-'));
    try {
      const root = join(dir, 'project');
      const alias = join(dir, 'alias');
      mkdirSync(root);
      symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
      const store = new DocumentStore(alias, 10);
      expect(store.projectRoot).toBe(realpathSync.native(root));
      expect(store.resolve('Main.lean')[0]).toBe(join(realpathSync.native(root), 'Main.lean'));
      expect(() => store.resolve('../outside.lean')).toThrow('outside project root');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
