export const MAX_SOURCE_NAME_CHARACTERS = 120;
export const MAX_SOURCE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const SOURCE_UPLOAD_TOO_LARGE_MESSAGE = 'File is too large. Maximum upload size is 20 MB.';

export function fileIsSupported(file: File): boolean {
  const filename = file.name.toLowerCase();
  return filename.endsWith('.tex')
    || filename.endsWith('.md')
    || filename.endsWith('.markdown')
    || filename.endsWith('.pdf');
}

export function fileKind(file: File): string {
  const filename = file.name.toLowerCase();
  if (filename.endsWith('.pdf')) return 'PDF';
  if (filename.endsWith('.md') || filename.endsWith('.markdown')) return 'Markdown';
  return 'LaTeX';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface SourceNameValidation {
  trimmedName: string;
  collision: boolean;
  tooLong: boolean;
}

export function validateSourceName(name: string, existingNames: string[]): SourceNameValidation {
  const trimmedName = name.trim();
  return {
    trimmedName,
    collision: existingNames.some(
      (existing) => existing.trim().toLowerCase() === trimmedName.toLowerCase(),
    ),
    tooLong: trimmedName.length > MAX_SOURCE_NAME_CHARACTERS,
  };
}
