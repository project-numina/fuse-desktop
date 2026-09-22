export function escapeHtmlValue(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttributeValue(text: string): string {
  return escapeHtmlValue(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function hasSafeUrlScheme(url: string): boolean {
  if (!url) return false;
  if (/^https?:\/\//i.test(url)) return true;
  if (url.startsWith('//')) return true;
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('./')) return true;
  return /^mailto:/i.test(url);
}

export function flushEscapedText(textBuffer: string[], out: string[]): void {
  if (textBuffer.length === 0) return;
  out.push(escapeHtmlValue(textBuffer.join('')));
  textBuffer.length = 0;
}
