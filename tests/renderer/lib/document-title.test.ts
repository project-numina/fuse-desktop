import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_DOCUMENT_TITLE, normalizedDocumentTitle, setDocumentTitle } from '@/lib/document-title';

describe('document title', () => {
  afterEach(() => { document.title = ''; });

  it('normalizes empty and named page titles', () => {
    expect(normalizedDocumentTitle(null)).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(normalizedDocumentTitle('')).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(normalizedDocumentTitle('Dashboard')).toBe('Dashboard');
  });

  it('updates the browser title', () => {
    setDocumentTitle('Account');
    expect(document.title).toBe('Account');
  });
});
