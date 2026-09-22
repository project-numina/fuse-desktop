/**
 * What a commit says: the diff-derived fallback subject/body, the agent-turn
 * subject rule, and the optional CLI-generated message with the web's prompt.
 */

import { argsAreShellSafe, spawnCli } from '../../agents/spawn';

export const MAX_SUBJECT_CHARACTERS = 72;
const MAX_DIFF_CHARACTERS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

export interface CommitMessage {
  subject: string;
  body: string | null;
}

export type AiCommitGenerator = (diff: string) => Promise<CommitMessage | null>;

function truncateSubject(subject: string): string {
  return subject.length > MAX_SUBJECT_CHARACTERS ? `${subject.slice(0, MAX_SUBJECT_CHARACTERS - 1).replace(/\s+$/, '')}…` : subject;
}

/** Normalize a b-side path from a unified diff header. */
export function cleanDiffPath(rawPath: string): string {
  let path = rawPath.trim();
  if (path === '/dev/null') return '';
  if (path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return path.startsWith('b/') ? path.slice(2) : path;
}

/** Unique b-side paths from unified diff headers. */
export function changedFiles(diff: string): string[] {
  const result: string[] = [];
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith('+++ ')) continue;
    const path = cleanDiffPath(line.slice(4));
    if (path && !result.includes(path)) result.push(path);
  }
  return result;
}

/** Added/deleted data lines, excluding unified-diff metadata. */
export function changedLineCounts(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

function formatChangeStats(additions: number, deletions: number): string {
  const parts: string[] = [];
  if (additions) parts.push(`+${additions}`);
  if (deletions) parts.push(`-${deletions}`);
  return parts.length ? `Line changes: ${parts.join(' / ')}.` : '';
}

/** Concise commit message derived from the staged diff (the web's ``fallback_message``). */
export function fallbackCommitMessage(stagedDiff: string, fallbackBody: string | null = null): CommitMessage {
  const files = changedFiles(stagedDiff);
  const { additions, deletions } = changedLineCounts(stagedDiff);
  let subject: string;
  if (files.length === 1) subject = `Update ${files[0]}`;
  else if (files.length > 0) subject = `Update ${files.length} files`;
  else subject = 'Update files';
  subject = truncateSubject(subject);
  let changed = files.slice(0, 5).join(', ');
  if (files.length > 5) changed = `${changed}, and ${files.length - 5} more`;
  const parts: string[] = [];
  if (changed) parts.push(`Changed: ${changed}.`);
  const stats = formatChangeStats(additions, deletions);
  if (stats) parts.push(stats);
  if (fallbackBody) parts.push(fallbackBody);
  return { subject, body: parts.length ? parts.join('\n\n') : fallbackBody };
}

/** ``Agent: <first line of the prompt>`` (72 chars max), or the incomplete variant. */
export function agentCommitSubject(userMessage: string, incomplete: boolean): string {
  const firstLine = userMessage.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const compact = firstLine.trim().replace(/\s+/g, ' ') || 'Update formalization files';
  const truncated = truncateSubject(compact);
  return `${incomplete ? 'Agent (incomplete): ' : 'Agent: '}${truncated}`;
}

export interface AgentCommitContext {
  blueprintName: string;
  owner: string;
  repo: string;
  agentJobId?: string | null;
  conversationId?: string | null;
  incomplete: boolean;
}

/** Trailer lines the Git tab strips from agent commit bodies. */
export function agentCommitMetadataFooter(context: AgentCommitContext): string {
  const lines = [`Blueprint: ${context.blueprintName}`, `Repository: ${context.owner}/${context.repo}`];
  if (context.agentJobId) lines.push(`Agent job: ${context.agentJobId}`);
  if (context.conversationId) lines.push(`Conversation: ${context.conversationId}`);
  if (context.incomplete) {
    lines.push('The agent turn did not complete cleanly; this commit preserves the partial changes made before the error.');
  }
  return lines.join('\n');
}

/** Strip fences/labels and split a model reply into subject and body. */
export function splitSubjectBody(raw: string): CommitMessage {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  text = text.replace(/^subject:\s*/i, '');
  let subject: string;
  let body: string;
  const blank = text.indexOf('\n\n');
  if (blank >= 0) {
    subject = text.slice(0, blank);
    body = text.slice(blank + 2);
  } else if (text.includes('\n')) {
    const newline = text.indexOf('\n');
    subject = text.slice(0, newline);
    body = text.slice(newline + 1);
  } else {
    subject = text;
    body = '';
  }
  subject = subject.trim().replace(/^["']|["']$/g, '').replace(/\.$/, '').trim();
  subject = truncateSubject(subject);
  const cleanedBody = body.trim();
  return { subject, body: cleanedBody || null };
}

export const COMMIT_MESSAGE_SYSTEM_PROMPT = `You write commit messages for a math formalization codebase (LaTeX 'blueprints' and Lean 4 source).

Output EXACTLY this format, with no preamble, quotes, code fences, or trailing commentary:

<subject>

<body>

Subject rules:
- Imperative mood ("Add", "Fix", "Refactor"), never past tense.
- At most 72 characters. No trailing period.
- Describe the substantive change, not the mechanics of the diff.

Body rules:
- One short paragraph or up to three short bullet points.
- Focus on what changed and why; skip file enumerations unless meaningful.
- Do NOT mention that this message was AI-generated or add co-author trailers.
- If the diff is trivial (whitespace, a single typo), keep the body to one short line.

When a 'User intent' line is provided it is the user's prompt that produced this work — treat it as additional context, but describe the actual diff rather than restating the prompt.`;

function commitMessageUserPrompt(diff: string, userMessage?: string): string {
  let bounded = diff;
  if (bounded.length > MAX_DIFF_CHARACTERS) bounded = `${bounded.slice(0, MAX_DIFF_CHARACTERS)}\n... (diff truncated)\n`;
  const intent = (userMessage ?? '').split(/\r?\n/).find((line) => line.trim())?.trim();
  return `${intent ? `User intent: ${intent}\n\n` : ''}Diff:\n${bounded}`;
}

/**
 * Ask the Claude Code CLI for a commit message (``claude -p``), bounded to
 * 8 s; null on any failure so a model hiccup never blocks a commit.
 */
export async function generateCommitMessageWithClaude(
  claudePath: string,
  diff: string,
  options: { userMessage?: string; model?: string } = {},
): Promise<CommitMessage | null> {
  const args = ['-p', '--output-format', 'text'];
  if (options.model) args.push('--model', options.model);
  // Windows launches npm shims through cmd.exe, which cannot carry the
  // multi-line prompt as an argument; fold it into stdin there instead.
  const viaShell = process.platform === 'win32' && !/\.exe$/i.test(claudePath || 'claude');
  const inlineSystemPrompt = viaShell && !argsAreShellSafe([...args, COMMIT_MESSAGE_SYSTEM_PROMPT]);
  if (!inlineSystemPrompt) args.push('--system-prompt', COMMIT_MESSAGE_SYSTEM_PROMPT);
  const prompt = commitMessageUserPrompt(diff, options.userMessage);
  const input = inlineSystemPrompt ? `${COMMIT_MESSAGE_SYSTEM_PROMPT}\n\n${prompt}` : prompt;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(claudePath || 'claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (value: CommitMessage | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, REQUEST_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }
      const parsed = splitSubjectBody(Buffer.concat(chunks).toString('utf8'));
      finish(parsed.subject ? parsed : null);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}
