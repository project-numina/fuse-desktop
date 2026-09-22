/**
 * Every prompt the agent is sent, and the context wrapped around it.
 *
 * The agent never receives a bare user message. Each turn is prefixed with
 * the repository/blueprint it is working in, the state of the Lean
 * environment, and a control block declaring the session's execution mode.
 * Two entry points cover the turn kinds: `buildInitialPrompt` for the first
 * message (which also inlines a prior transcript when the provider cannot
 * resume) and `buildFollowUpPrompt` for later user turns; a steer that joins
 * a running turn gets the thinner `buildSteeringMessage` framing.
 *
 * The system prompt itself ships with the app under `resources/prompts`
 * (`system-prompt.md` for Claude Code, `system-prompt-codex.md` for Codex,
 * optional `delegation-<provider>.md` for a `{delegation_section}` slot),
 * with `{braces}` placeholders filled here. A short built-in prompt covers
 * a broken install.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderId } from '@shared/agent-events';
import type { ChatContextAttachmentPayload, MessageDeliveryState, SessionChatMessage } from '@shared/api-types';
import { messageWithContext, type AttachmentPromptContext } from './attachments';

export type LeanEnvironmentState =
  | { kind: 'ready' }
  | { kind: 'building' }
  | { kind: 'not_built' }
  | { kind: 'failed'; detail: string };

export interface PromptPlacement {
  repoLabel: string;
  repoRoot: string;
  workingDirectory?: string;
  projectRoot: string;
  projectSubdir: string;
  blueprintName: string;
  blueprintTexPath: string;
  leanModule: string | null;
}

export interface SystemPromptSources {
  /** `resources/prompts` directory shipped with the app. */
  promptsDir: string;
  provider: ProviderId;
}

const FALLBACK_SYSTEM_PROMPT = `# Identity

You are a formalization-only assistant for Lean 4 mathematics. You help mathematicians turn informal proofs into verified Lean 4 code in this repository. Within that scope, default to doing what the user asks. Outside of it, refuse in one short sentence and offer to formalize something instead.

# Where you are

Repository root: {repo_root}
Lean project root: {project_root}
Blueprint entrypoint: {blueprint_tex}
Blueprint name: {blueprint_name}
Lean module for this blueprint: {lean_module}

# How to work

Blueprint metadata lives in Fuse's local store, not in files; read and write it only through the \`fuse\` MCP tools (\`blueprint_get_summary\`, \`blueprint_list_declarations\`, \`blueprint_read_declarations\`, \`blueprint_update_declarations\`, \`blueprint_set_declaration_status\`, \`blueprint_refresh\`, \`blueprint_validate\`). Use \`lean_diagnostic_messages\` and \`lean_goal\` after every edit, \`lean_build\` (optionally with a module target) for cross-file verification, and never run \`lake update\` or \`lake exe cache get\` without asking. Never use \`native_decide\`. Do not commit unless the user asks.

{delegation_section}

# Communication style

Short and concise. No emojis. Reference code as \`file_path:line_number\`. Every user-facing reply must end with exactly one next-step suggestion wrapped in <suggest> and </suggest>, phrased in the user's voice. Do not mention the tags.
`;

const FALLBACK_DELEGATION: Record<ProviderId, string> = {
  claude:
    '# Delegation\n\nHeavy Lean work runs in subagents launched with the `Task` tool (`blueprint`, `blueprint-reviewer`, `formalizer`, `formalizer-reviewer`, `prover`, `golfer`, `prover-reviewer`, `explorer`). Order the work by the blueprint\'s `\\uses{}` dependencies and keep dependency analysis, verification and metadata reconciliation to yourself.',
  codex:
    '# Working alone\n\nThere are no subagents in this runtime. Do every stage yourself, sequentially, reviewing your own blueprint edits and Lean statements before proving. Prove declarations one at a time in dependency order and record every status change as you go.',
};

function readIfPresent(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

/** Fill `{placeholder}` slots; unknown placeholders are left untouched. */
export function fillPlaceholders(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) => (key in values ? values[key] : match));
}

/**
 * Render the system prompt for one session. Reads the shipped prompt files
 * on every call so an edited resource takes effect on the next session.
 */
export function renderSystemPrompt(sources: SystemPromptSources, placement: PromptPlacement): string {
  const template =
    (sources.provider === 'codex' ? readIfPresent(join(sources.promptsDir, 'system-prompt-codex.md')) : null) ??
    readIfPresent(join(sources.promptsDir, 'system-prompt.md')) ??
    FALLBACK_SYSTEM_PROMPT;
  const delegation =
    readIfPresent(join(sources.promptsDir, `delegation-${sources.provider}.md`)) ?? FALLBACK_DELEGATION[sources.provider];
  // `claude --plugin-dir` loads the plugin's agents but not its root
  // CLAUDE.md, and Codex has no plugin mechanism at all, so the blueprint
  // conventions are folded into the system prompt for both providers.
  const conventions = readIfPresent(join(sources.promptsDir, 'blueprint', 'CLAUDE.md'));
  const body = conventions ? `${template.trim()}\n\n${conventions.trim()}` : template;
  return fillPlaceholders(body, {
    repo_root: placement.repoRoot,
    project_root: placement.projectRoot,
    project_subdir: placement.projectSubdir || '.',
    blueprint_tex: placement.blueprintTexPath,
    blueprint_name: placement.blueprintName,
    lean_module: placement.leanModule ?? '(not recorded yet; read it from the lakefile)',
    delegation_section: delegation.trim(),
  }).trim();
}

/** Describe current repository/build availability for the orchestrator. */
export function buildEnvironmentStatus(state: LeanEnvironmentState): string {
  const repo = 'Repository status: folder is open.';
  switch (state.kind) {
    case 'failed':
      return (
        `${repo}\n` +
        `Lean environment status: toolchain failure (${state.detail}).\n` +
        'You may still inspect and edit repository files, but Lean/LSP-dependent actions may fail until the environment is repaired.'
      );
    case 'ready':
      return (
        `${repo}\n` +
        'Lean environment status: ready (per-file build errors, if any, are visible in the file tree and via lean_diagnostic_messages).'
      );
    case 'not_built':
      return (
        `${repo}\n` +
        'Lean environment status: the project has not been built yet in this app. Run lean_build (or lake build) before relying on cross-file verification; per-file checks through lean_diagnostic_messages still work once dependencies are present.'
      );
    case 'building':
    default:
      return (
        `${repo}\n` +
        'Lean environment status: still preparing in the background.\n' +
        'Answer the user normally. If they ask for something that needs Lean (LSP queries, lake/lean commands, build-dependent verification), ' +
        'tell them in one short sentence that the environment is still preparing and proceed with what you can do (read files, discuss the ' +
        "math, plan the formalization). Don't re-announce the build status when it isn't relevant to what's being asked."
      );
  }
}

/** The structured mode-control block consumed by the system prompt. */
export function buildModeContext(reason: string): string {
  return [
    'CONTROL MESSAGE',
    'target_mode: autonomous',
    `reason: ${reason}`,
    'Treat this control message as authoritative mode context.',
  ].join('\n');
}

export interface ResumeTranscriptMessage extends SessionChatMessage {
  delivery_state?: MessageDeliveryState;
}

export interface InitialPromptInput {
  placement: PromptPlacement;
  environment: LeanEnvironmentState;
  message: string;
  attachments: readonly ChatContextAttachmentPayload[];
  /** Persisted transcript to replay when the provider cannot resume the thread. */
  resumeMessages: readonly ResumeTranscriptMessage[];
  /** True when the provider resumes its own thread; the transcript is then not replayed. */
  providerResumes: boolean;
  attachmentContext: AttachmentPromptContext | null;
}

function titleCase(role: string): string {
  return role ? role[0].toUpperCase() + role.slice(1) : role;
}

/** Prepend repo/blueprint context to the user's first message. */
export function buildInitialPrompt(input: InitialPromptInput): string {
  const { placement, attachmentContext } = input;
  const environmentStatus = buildEnvironmentStatus(input.environment);
  const selectedProject = placement.projectSubdir || '.';
  let context =
    `You are working on the blueprint '${placement.blueprintName}' in ${placement.repoLabel}.\n` +
    `Blueprint LaTeX: ${placement.blueprintTexPath}\n` +
    (placement.workingDirectory && placement.workingDirectory !== placement.repoRoot
      ? `The working directory is ${placement.workingDirectory}. The repository root is ${placement.repoRoot}.\n`
      : `The working directory is the repository root (${placement.repoRoot}).\n`) +
    `The Lean project root is ${placement.projectRoot} ('${selectedProject}' within the repository); run lake and lean commands there.\n` +
    `${environmentStatus}\n\n` +
    buildModeContext('session start');
  if (input.environment.kind === 'building') {
    context += '\nOn every user turn, first send a brief natural-language reply to the user before using any tools.';
  }
  const retained = input.resumeMessages.filter((message) => message.delivery_state === 'retained');
  const replay = input.resumeMessages.filter(
    (message) => !['queued', 'retained', 'superseded'].includes(message.delivery_state ?? ''),
  );
  if (!input.providerResumes && replay.length > 0) {
    const transcript = replay
      .map((message) => `${titleCase(message.role)}: ${messageWithContext(message.content, message.context_attachments, attachmentContext)}`)
      .join('\n');
    context +=
      '\nThis is a continuation of an earlier chat session.' +
      '\nUse the transcript below as prior conversation context.\n\n' +
      transcript;
  }
  if (retained.length > 0) {
    const retainedContext = retained
      .map((message) => `User: ${messageWithContext(message.content, message.context_attachments, attachmentContext)}`)
      .join('\n');
    context +=
      '\nThe user sent the messages below before stopping the previous run. Treat them as context for the new message, ' +
      'not as separate requests requiring their own responses.\n\n' +
      retainedContext;
  }
  const message = messageWithContext(input.message, input.attachments, attachmentContext);
  return `${context}\n\nUser message: ${message}`;
}

/** Wrap a follow-up user message with environment and mode context. */
export function buildFollowUpPrompt(
  environment: LeanEnvironmentState,
  content: string,
  attachments: readonly ChatContextAttachmentPayload[],
  attachmentContext: AttachmentPromptContext | null,
): string {
  const prompt = `${buildEnvironmentStatus(environment)}\n${buildModeContext('follow-up user turn')}\n`;
  return `${prompt}\nUser message: ${messageWithContext(content, attachments, attachmentContext)}`;
}

/**
 * Render a further user message that the same turn also answers. Carries no
 * preamble: the first message of the turn already opened with one.
 */
export function buildAdditionalUserMessage(
  content: string,
  attachments: readonly ChatContextAttachmentPayload[],
  attachmentContext: AttachmentPromptContext | null,
): string {
  return `User message: ${messageWithContext(content, attachments, attachmentContext)}`;
}

/**
 * Wrap a user message injected into a turn that is already running. The
 * framing only tells the model when the message arrived and that arriving
 * mid-task is not itself an instruction to stop.
 */
export function buildSteeringMessage(
  content: string,
  attachments: readonly ChatContextAttachmentPayload[],
  attachmentContext: AttachmentPromptContext | null,
): string {
  return (
    'USER MESSAGE (arrived while you were working)\n' +
    'The user sent this during the step you are currently running. Take it into account from here on. ' +
    'It does not by itself mean abandon the current step — judge that from the message.\n\n' +
    `User message: ${messageWithContext(content, attachments, attachmentContext)}`
  );
}

/** Sent once after a turn produced no output for the activity timeout. */
export const AUTONOMOUS_RECOVERY_PROMPT = [
  'CONTROL MESSAGE',
  'target_mode: autonomous',
  'reason: previous autonomous turn was interrupted after producing no SDK output for the configured activity timeout.',
  'Resume the same user-requested scope. First inspect the current repository state and background notes, then continue with the next actionable step. Do not repeat the same silent reasoning path; use tools or provide a concise progress update before continuing.',
].join('\n');

/** Title shown in the history list: the first non-blank line of the first prompt. */
export function titleFromPrompt(prompt: string, maxLength = 80): string | null {
  const line = prompt
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) return null;
  const compact = line.replace(/\s+/g, ' ');
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Commit subject for an agent turn: `Agent: <first prompt line>` (≤ 72 chars). */
export function agentCommitSubject(userMessage: string, incomplete: boolean): string {
  const line = userMessage
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  const compact = (line ?? 'Update formalization files').replace(/\s+/g, ' ');
  const truncated = compact.length <= 72 ? compact : `${compact.slice(0, 71).trimEnd()}…`;
  return `${incomplete ? 'Agent (incomplete)' : 'Agent'}: ${truncated}`;
}
