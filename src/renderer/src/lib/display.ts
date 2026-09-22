/**
 * Display utility functions for formatting declaration kinds, border styles,
 * line numbers, timestamps, and currency.
 *
 * This is the shared date/format util for the React app: components import
 * `formatShortDateTime`, `formatDateTime`, `formatUSD`, `timeAgo`, and
 * `truncate` from here rather than redefining them.
 */

/**
 * Capitalizes a declaration kind for display (e.g. "theorem" → "Theorem").
 * @param {string} kind Declaration kind (theorem, lemma, definition, etc.).
 * @return {string}
 */
export function kindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Border colors per declaration kind, kept in sync with --badge-*-border
 * tokens in the design tokens.
 */
const KIND_BORDER_COLORS: Record<string, string> = {
  theorem: '#60a5fa',
  definition: '#67e8f9',
  lemma: '#a78bfa',
  corollary: '#5eead4',
};
const DEFAULT_BORDER_COLOR = '#fcd34d';

/**
 * Maps a declaration kind to its border color hex value.
 * @param {string} kind Declaration kind.
 * @return {string} CSS color string.
 */
export function kindBorderColor(kind: string): string {
  return KIND_BORDER_COLORS[kind] || DEFAULT_BORDER_COLOR;
}

/**
 * Builds an inline border-left style for a code segment's declaration region.
 * The colored border spans only the declaration lines (not the proof).
 * @param segment A code segment from buildSegments or latexSegments.
 * @return React inline style object, or empty object for non-decl segments.
 */
interface DeclarationSegment {
  type: string;
  entry?: { kind: string };
  declarationLineCount?: number;
  text?: string;
  lineStart?: number;
}

export function declarationBorderStyle(segment: DeclarationSegment): Record<string, string> {
  if (segment.type !== 'decl') return {};
  if (!segment.entry || segment.declarationLineCount == null) return {};
  const fullColor = kindBorderColor(segment.entry.kind);
  // Fixed height in rem: declarationLineCount * (font-size 0.8125rem * line-height 1.5)
  const height = (segment.declarationLineCount * 0.8125 * 1.5).toFixed(4);
  return {
    borderLeft: '3px solid',
    borderImage: `linear-gradient(to bottom, ${fullColor} ${height}rem, transparent ${height}rem) 1`,
  };
}

/**
 * Generates newline-separated line numbers for a code segment.
 * @param segment A code segment with text and lineStart.
 * @return {string} Line numbers joined by newlines (e.g. "5\n6\n7").
 */
export function lineNumberText(segment: { text: string; lineStart: number }): string {
  const count = segment.text.split('\n').length;
  return Array.from({ length: count }, (_, i) => segment.lineStart + i).join('\n');
}


/**
 * Formats a date string as a relative time (e.g. "2 days ago").
 * @param {string} dateString ISO date string.
 * @return {string}
 */
export function timeAgo(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const difference = now.getTime() - date.getTime();
  const days = Math.floor(difference / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/**
 * Formats a date/time as a compact, locale-aware string
 * (e.g. "Jun 24, 3:05 PM"). Returns an em dash for null-like input.
 * @param value Date value to format.
 * @return {string} Formatted date-time, or "—" when value is missing.
 */
export function formatShortDateTime(
  value: string | number | Date | null | undefined,
): string {
  if (value == null || value === '') return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Formats a date/time as a full, locale-aware string via toLocaleString
 * (date and time, including the year). Returns an em dash for null-like input.
 * @param value Date value to format.
 * @return {string} Formatted date-time, or "—" when value is missing.
 */
export function formatDateTime(
  value: string | number | Date | null | undefined,
): string {
  if (value == null || value === '') return '—';
  return new Date(value).toLocaleString();
}

/**
 * Formats a numeric amount as US dollars (e.g. 12.5 → "$12.50").
 * Treats null-like input as $0.00.
 * @param value Dollar amount.
 * @return {string} Currency string.
 */
export function formatUSD(value: number | null | undefined): string {
  if (value == null) return '$0.00';
  return `$${value.toFixed(2)}`;
}

/**
 * Formats a token count compactly (e.g. 18400 → "18.4k").
 * Used where the magnitude is what matters, not the exact figure.
 * @param {number} value Token count.
 * @return {string} Compact count.
 */
export function formatTokenCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/**
 * Truncates text to a maximum length, appending an ellipsis when shortened.
 * @param {string} text Text to truncate.
 * @param {number} max Maximum length before truncation.
 * @return {string} Original or truncated text.
 */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}
