import { describe, expect, it } from 'vitest';

import {
  fileIsSupported,
  fileKind,
  formatBytes,
  MAX_SOURCE_NAME_CHARACTERS,
  validateSourceName,
} from '@/features/blueprint/components/source-upload-modal/helpers';

describe('source upload modal helpers', () => {
  it('recognizes supported source extensions case-insensitively', () => {
    expect(fileIsSupported(new File([], 'NOTES.TEX'))).toBe(true);
    expect(fileIsSupported(new File([], 'paper.MarkDown'))).toBe(true);
    expect(fileIsSupported(new File([], 'scan.PDF'))).toBe(true);
    expect(fileIsSupported(new File([], 'notes.txt'))).toBe(false);
  });

  it('labels source kinds from their filenames', () => {
    expect(fileKind(new File([], 'paper.pdf'))).toBe('PDF');
    expect(fileKind(new File([], 'notes.md'))).toBe('Markdown');
    expect(fileKind(new File([], 'proof.tex'))).toBe('LaTeX');
  });

  it('formats upload sizes at readable units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('normalizes names for collision and length validation', () => {
    expect(validateSourceName(' notes ', ['Notes'])).toMatchObject({
      trimmedName: 'notes', collision: true, tooLong: false,
    });
    expect(validateSourceName('x'.repeat(MAX_SOURCE_NAME_CHARACTERS + 1), [])).toMatchObject({
      collision: false, tooLong: true,
    });
  });
});
