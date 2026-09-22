/**
 * Pure parsers for git output: `log -z` entries, `diff --numstat -z`,
 * unified patch streams and C-quoted paths. Ported line for line from the
 * web backend's history/changes parsers so the Git tab sees identical data.
 */

import type { BlueprintCommitDetailFile, BlueprintDiffStatus } from '@shared/api-types';
import { isValidCommitSha } from './pathspecs';

export const LOG_FORMAT = '%H%x1f%an%x1f%ae%x1f%aI%x1f%B';
export const DEFAULT_MAX_PATCH_BYTES = 200_000;

export interface CommitInfo {
  sha: string;
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  authoredAt: string | null;
}

export interface NumstatEntry {
  additions: number;
  deletions: number;
  binary: boolean;
  oldPath: string | null;
}

export interface PatchEntry {
  body: string;
  status: BlueprintDiffStatus;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });
const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Python's ``str.splitlines`` boundaries: every line break character, with
 * CRLF as a single boundary and no trailing empty line.
 */
export function splitLines(text: string): string[] {
  if (!text) return [];
  // eslint-disable-next-line no-control-regex -- Python's splitlines boundaries include these separators.
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Decode git's C-style quoted path spelling (``"a/caf\303\251.tex"``). */
export function unquoteGitPath(value: string): string {
  const data: number[] = [];
  const simple: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    index += 1;
    if (character !== '\\') {
      data.push(...encoder.encode(character));
      continue;
    }
    if (index === value.length) {
      data.push(0x5c);
      break;
    }
    const escaped = value[index];
    index += 1;
    if (escaped in simple) {
      data.push(simple[escaped]);
    } else if (escaped === '"' || escaped === '\\') {
      data.push(escaped.charCodeAt(0));
    } else if (escaped >= '0' && escaped <= '7') {
      let digits = escaped;
      while (index < value.length && digits.length < 3 && value[index] >= '0' && value[index] <= '7') {
        digits += value[index];
        index += 1;
      }
      data.push(Number.parseInt(digits, 8));
    } else {
      data.push(...encoder.encode(escaped));
    }
  }
  return utf8.decode(new Uint8Array(data));
}

const DIFF_HEADER = /^diff --git (?:"a\/(?<aQuoted>(?:[^"\\]|\\.)*)"|a\/(?<a>\S+))\s(?:"b\/(?<bQuoted>(?:[^"\\]|\\.)*)"|b\/(?<b>\S+))$/;

/** The b-side path of a ``diff --git`` header, or null when unparseable. */
export function headerPath(header: string): string | null {
  const match = DIFF_HEADER.exec(header);
  if (match?.groups) {
    const quoted = match.groups.bQuoted;
    return quoted !== undefined ? unquoteGitPath(quoted) : match.groups.b;
  }
  const marker = ' b/';
  const position = header.lastIndexOf(marker);
  return position < 0 ? null : header.slice(position + marker.length);
}

/** Parse one NUL-delimited entry emitted by ``LOG_FORMAT``. */
export function parseLogEntry(raw: string): CommitInfo | null {
  const fields = splitN(raw, '\x1f', 4);
  if (fields.length !== 5 || !isValidCommitSha(fields[0].trim())) return null;
  const [sha, name, email, date, message] = fields;
  return {
    sha: sha.trim(),
    message: message.replace(/\s+$/, ''),
    authorName: name || null,
    authorEmail: email || null,
    authoredAt: date || null,
  };
}

/** Python's ``str.split(sep, maxsplit)``. */
function splitN(value: string, separator: string, maxSplit: number): string[] {
  const parts: string[] = [];
  let rest = value;
  while (parts.length < maxSplit) {
    const position = rest.indexOf(separator);
    if (position < 0) break;
    parts.push(rest.slice(0, position));
    rest = rest.slice(position + separator.length);
  }
  parts.push(rest);
  return parts;
}

const INTEGER = /^[+-]?\d+$/;

/** Parse ``git diff --numstat -z`` output, including binary and rename entries. */
export function parseNumstat(raw: string): Map<string, NumstatEntry> {
  const parsed = new Map<string, NumstatEntry>();
  const records = raw.split('\0');
  let index = 0;
  while (index < records.length) {
    const record = records[index];
    index += 1;
    const fields = splitN(record, '\t', 2);
    if (fields.length !== 3) continue;
    const [adds, deletes] = fields;
    let path = fields[2];
    let oldPath: string | null = null;
    if (!path) {
      if (index + 1 >= records.length) continue;
      oldPath = records[index];
      path = records[index + 1];
      index += 2;
    }
    if (!path) continue;
    const binary = adds === '-' && deletes === '-';
    if (!binary && (!INTEGER.test(adds.trim()) || !INTEGER.test(deletes.trim()))) continue;
    parsed.set(path, {
      additions: binary ? 0 : Number.parseInt(adds.trim(), 10),
      deletions: binary ? 0 : Number.parseInt(deletes.trim(), 10),
      binary,
      oldPath,
    });
  }
  return parsed;
}

function storePatch(destination: Map<string, PatchEntry>, path: string | null, lines: string[]): void {
  if (path === null) return;
  let status: BlueprintDiffStatus = 'modified';
  if (lines.some((line) => line.startsWith('new file mode'))) status = 'added';
  else if (lines.some((line) => line.startsWith('deleted file mode'))) status = 'deleted';
  else if (lines.some((line) => line.startsWith('rename from '))) status = 'renamed';
  destination.set(path, { body: lines.join('\n'), status });
}

/** Split unified git output into per-path patches (working-tree diff). */
export function splitPatchStream(raw: string): Map<string, PatchEntry> {
  const entries = new Map<string, PatchEntry>();
  let current: string[] = [];
  let path: string | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      storePatch(entries, path, current);
      current = [line];
      path = headerPath(line);
    } else if (path !== null) {
      current.push(line);
    }
  }
  storePatch(entries, path, current);
  return entries;
}

/** Render text as a concise unified diff against ``/dev/null``. */
export function synthesizeAddedPatch(path: string, content: string): string {
  const lines = splitLines(content);
  const count = countNewlines(content) + (content && !content.endsWith('\n') ? 1 : 0);
  const body = lines.map((line) => `+${line}`);
  if (content && !content.endsWith('\n')) body.push('\\ No newline at end of file');
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${count} @@`,
    ...body,
  ].join('\n');
}

/** Render a symlink as the target string git stores in a mode-120000 blob. */
export function synthesizeSymlinkPatch(path: string, target: string): string {
  return synthesizeAddedPatch(path, target).replace('new file mode 100644', 'new file mode 120000');
}

export function countNewlines(text: string): number {
  let count = 0;
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) count += 1;
  return count;
}

/** First ``rename from`` path of a patch body, if any. */
export function patchOldPath(patch: string | null): string | null {
  if (patch === null) return null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('rename from ')) return line.slice('rename from '.length);
  }
  return null;
}

function countPatchLines(lines: string[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (inHunk && line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

function parsePatchChunk(lines: string[], cap: number): BlueprintCommitDetailFile | null {
  const path = headerPath(lines[0]);
  if (path === null) return null;
  const joined = lines.join('\n');
  let status = lines.some((line) => line.startsWith('rename from ')) ? 'renamed' : 'modified';
  if (lines.some((line) => line.startsWith('new file mode'))) status = 'added';
  else if (lines.some((line) => line.startsWith('deleted file mode'))) status = 'deleted';
  const renameLine = lines.find((line) => line.startsWith('rename from '));
  const oldPath = renameLine !== undefined ? renameLine.slice(12) : null;
  const binary = lines.some((line) => line.includes('Binary files') && line.includes('differ'));
  const { additions, deletions } = countPatchLines(lines);
  const tooLarge = utf8ByteLength(joined) > cap;
  return { path, status, old_path: oldPath, additions, deletions, patch: binary || tooLarge ? null : joined };
}

/** Parse ``git show --format=`` output into file records (commit detail). */
export function parseCommitPatch(raw: string, maxPatchBytes = DEFAULT_MAX_PATCH_BYTES): BlueprintCommitDetailFile[] {
  if (!Number.isInteger(maxPatchBytes) || maxPatchBytes <= 0) {
    throw new RangeError('max_patch_bytes must be a positive integer');
  }
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      chunks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0 && current.some((line) => line.startsWith('diff --git '))) chunks.push(current);
  const files: BlueprintCommitDetailFile[] = [];
  for (const chunk of chunks) {
    // Lines before the first header are discarded: a chunk starts at its header.
    const start = chunk.findIndex((line) => line.startsWith('diff --git '));
    const parsed = parsePatchChunk(chunk.slice(start), maxPatchBytes);
    if (parsed) files.push(parsed);
  }
  return files;
}

const NOREPLY_DOMAIN = '@users.noreply.github.com';

/**
 * Pull a GitHub login out of the git-author block when possible: the two
 * noreply email shapes, or a ``*[bot]`` author name. Null for real addresses.
 */
export function deriveGithubLogin(authorName: string | null, authorEmail: string | null): string | null {
  const email = authorEmail ?? '';
  if (email.endsWith(NOREPLY_DOMAIN)) {
    const localPart = email.slice(0, -NOREPLY_DOMAIN.length);
    if (localPart.includes('+')) {
      const login = localPart.slice(localPart.indexOf('+') + 1);
      return login || null;
    }
    return localPart || null;
  }
  if ((authorName ?? '').endsWith('[bot]')) return authorName;
  return null;
}

export function avatarUrlForLogin(login: string | null): string | null {
  return login ? `https://github.com/${login}.png` : null;
}
