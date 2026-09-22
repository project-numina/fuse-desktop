/**
 * Sets `document.title` from route metadata, falling back to the app name.
 * Electron mirrors `document.title` into the window title bar.
 */

export const DEFAULT_DOCUMENT_TITLE = 'Fuse';

export function normalizedDocumentTitle(
  title: string | null | undefined,
): string {
  const trimmedTitle = title?.trim();
  return trimmedTitle || DEFAULT_DOCUMENT_TITLE;
}

export function setDocumentTitle(title: string | null | undefined): void {
  document.title = normalizedDocumentTitle(title);
}
