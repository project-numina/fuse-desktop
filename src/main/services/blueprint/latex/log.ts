/**
 * Warning sink for the LaTeX modules.
 *
 * The parser and the tag writer report discarded `\proves` claims and
 * overlapping edits as warnings rather than errors: the source is still
 * usable, but a human should know. Tests assert on those messages, so the
 * sink is replaceable instead of hard-wired to `console.warn`.
 */

export type LatexWarningSink = (message: string) => void;

let sink: LatexWarningSink = (message) => console.warn(`[latex] ${message}`);

/** Route warnings to `next`; `null` restores the console default. */
export function setLatexWarningSink(next: LatexWarningSink | null): void {
  sink = next ?? ((message) => console.warn(`[latex] ${message}`));
}

export function logLatexWarning(message: string): void {
  sink(message);
}
