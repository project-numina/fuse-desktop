/**
 * Pure helpers for deriving display line counts for tool-call renderers.
 *
 * Backend may attach a `_fuse_display` blob to a tool
 * call's raw input carrying authoritative line counts; these helpers read it,
 * falling back to counting the rendered text.
 */

export function countDisplayLines(text: string): number {
  if (!text) return 0;
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  return trimmed.split('\n').length;
}

export function metadataLineCount(
  rawInput: Record<string, unknown>,
  field: string,
): number | null {
  const metadata = rawInput._fuse_display;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const lineCounts = (metadata as Record<string, unknown>).line_counts;
  if (!lineCounts || typeof lineCounts !== 'object' || Array.isArray(lineCounts)) {
    return null;
  }
  const count = (lineCounts as Record<string, unknown>)[field];
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
}
