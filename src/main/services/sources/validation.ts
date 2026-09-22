import type { RepositorySourceType } from '@shared/api-types';
import { HttpError } from '../../store/registry';
import { PDF_UNREADABLE_DETAIL, validatePdfUpload } from './pdf';

export const MAX_SOURCE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const SOURCE_UPLOAD_TOO_LARGE_DETAIL = 'File is too large. Maximum upload size is 20 MB.';
export const MAX_SOURCE_NAME_CHARACTERS = 120;

const SUPPORTED_EXTENSIONS = ['.pdf', '.tex', '.md', '.markdown'];
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export type ValidatedPayload = { type: 'pdf'; bytes: Uint8Array } | { type: 'latex' | 'markdown'; text: string };

function sourceTypeFor(filename: string): Exclude<RepositorySourceType, 'mixed'> | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.tex')) return 'latex';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return null;
}

export function hasSupportedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function decodeTextUpload(bytes: Uint8Array, fileType: string): string {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    throw new HttpError(400, `Uploaded ${fileType} file is not valid UTF-8.`, 'http_400');
  }
}

/** Validate source bytes and return their managed type and payload. */
export async function validatedSourcePayload(filename: string, bytes: Uint8Array): Promise<ValidatedPayload> {
  const type = sourceTypeFor(filename) as ValidatedPayload['type'] | null;
  if (type === null) {
    throw new HttpError(400, 'Unsupported file type. Please choose a .tex, .md, .markdown, or .pdf file.', 'http_400');
  }
  if (bytes.length > MAX_SOURCE_UPLOAD_BYTES) throw new HttpError(400, SOURCE_UPLOAD_TOO_LARGE_DETAIL, 'http_400');
  if (type === 'pdf') {
    try {
      await validatePdfUpload(bytes);
    } catch {
      throw new HttpError(400, PDF_UNREADABLE_DETAIL, 'http_400');
    }
    return { type, bytes };
  }
  const fileType = type === 'latex' ? '.tex' : '.md';
  return { type, text: decodeTextUpload(bytes, fileType) };
}
