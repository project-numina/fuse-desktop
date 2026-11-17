import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CODEX_ROLE_NAMES = [
  'blueprint', 'blueprint-reviewer', 'formalizer', 'formalizer-reviewer',
  'prover', 'golfer', 'prover-reviewer', 'explorer',
] as const;

export const CODEX_MAX_PARALLEL_AGENTS = 8;

export const CODEX_LEAN_RESOURCE_INSTRUCTIONS = `## Lean resource coordination

Parallel proof work does not authorize parallel compiler processes. Use Fuse verification tools, which schedule diagnostics and builds through a shared queue. Independent agents may submit verification requests; wait for their results instead of spawning additional compilers. Keep build planning with the orchestrator.
Never start lake or lean through the shell as a fallback for a slow, timed-out, or blocked Fuse tool. A tool timeout does not cancel its background work. Check get_build_status when a tool reports a build in progress; let queued verification finish. While blocked, inspect source or reason about proofs instead of retrying compiler calls. Do not increase memory, threads, or open-file limits to force progress. Report the exact verification blocker and leave declarations unproved until verified.`;

/** Provider-neutral role content ready for Codex agent configuration. */
export interface CodexRoleDefinition {
  name: `fuse:${typeof CODEX_ROLE_NAMES[number]}`;
  description: string;
  developerInstructions: string;
}

export const CODEX_DELEGATION_INSTRUCTIONS = `# Delegation

Fuse requests role-based delegation for substantive work by default. Follow the per-turn Fuse workflow request without asking the user to repeat permission to use subagents. Respect explicit instructions in the conversation to work alone or restrict delegation; do not expand the user's task scope.
Use the native collaboration tools actually exposed in this session. On current Codex, call collaboration.spawn_agent(task_name="prove_lemma", agent_type="fuse:prover", message=...). task_name and message are required tool arguments; task_name uses lowercase letters, digits and underscores. agent_type selects the role. The eight roles are fuse:blueprint, fuse:blueprint-reviewer, fuse:formalizer, fuse:formalizer-reviewer, fuse:prover, fuse:golfer, fuse:prover-reviewer, and fuse:explorer.
Keep at most 8 agents active at once across all roles. Track the returned task_name (canonical agent path). Collect updates with wait_agent(timeout_ms=10000), inspect list_agents(), send feedback with send_message(target=..., message=...), and start another assignment with followup_task(target=..., message=...). interrupt_agent(target=...) interrupts a worker; it does not close or delete it. A wait timeout is not completion; keep tracking the agent. Do not invent close_agent or send_input when they are not exposed. Older sessions may expose wait/send_input/close_agent instead: follow their actual schemas, rather than mixing the two APIs.
Only the orchestrator may delegate. Subagents cannot launch subagents and must report requests for other roles to the orchestrator.
Use separate writer and reviewer agents for blueprint and formalization work. Forward the reviewer's full feedback to the writer, then review the revision. Each writer/reviewer loop has at most 3 rounds per request; after the third failed review report the remaining issues rather than continuing the loop or claiming approval. Do not replace independent review with self-review.
Give each agent a self-contained message with scope, labels, file paths, blueprint name, relevantDeclarations, hints, and the required result. Agents share the working directory and Fuse MCP tools. Keep dependency analysis, verification, and metadata reconciliation with the orchestrator. Run one prover per declaration and parallelize only independent declarations; preserve other agents' edits.

${CODEX_LEAN_RESOURCE_INSTRUCTIONS}`;

/** Translate shipped Claude tool vocabulary without changing the shared resources. */
export function adaptPromptForCodex(text: string): string {
  return text
    .replace(/Task\(subagent_type=/g, 'spawn_agent(task_name="role_task", agent_type=')
    .replace(/(spawn_agent\([^\n)]*?), prompt=/g, '$1, message=')
    .replace(/`Task`/g, '`spawn_agent`')
    .replace(/`Read` \(PDFs included\)/g, 'the shell (extract PDF text with an available local utility first)')
    .replace(/`Grep`/g, '`rg` through the shell')
    .replace(/`Glob`/g, '`rg --files` through the shell')
    .replace(/`Read`/g, 'the shell to read files')
    .replace(/`(?:Edit|Write)`/g, '`apply_patch`')
    .replace(/`Bash`|\*\*Bash\*\*|\bBash(?= tool\b)|(?<=through )Bash\b/g, 'shell');
}

function parseRole(source: string, role: typeof CODEX_ROLE_NAMES[number]): CodexRoleDefinition {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`Invalid Codex role ${role}: missing frontmatter`);
  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^(name|description):\s*(.*?)\s*$/.exec(line);
    if (!field) continue;
    if (fields.has(field[1])) throw new Error(`Invalid Codex role ${role}: duplicate ${field[1]}`);
    const value = field[2].replace(/^(["'])(.*)\1$/, '$2');
    fields.set(field[1], value);
  }
  const description = fields.get('description');
  if (fields.get('name') !== role || !description || /^[>|][-+]?\d*$/.test(description) || !match[2].trim()) {
    throw new Error(`Invalid Codex role ${role}: expected matching name, scalar description, and body`);
  }
  return {
    name: `fuse:${role}`,
    description,
    developerInstructions: `${adaptPromptForCodex(match[2].trim())}\n\n## Delegation boundary\n\nYou are the fuse:${role} subagent, not the orchestrator. Do not launch subagents or call spawn_agent. Complete your assigned role yourself; return any request for another role to the orchestrator. Use the available shell for reading and searching files and apply_patch for file edits, subject to this role's read-only and scope restrictions. Report to the orchestrator in the role's required format.\n\n${CODEX_LEAN_RESOURCE_INSTRUCTIONS}\n\nThese verification coordination rules take precedence over verification steps in the role workflow above.`,
  };
}

/** Read all eight shipped roles; reject missing or malformed resources before launch. */
export function loadCodexRoles(promptsDir: string): CodexRoleDefinition[] {
  return CODEX_ROLE_NAMES.map((role) => {
    const path = join(promptsDir, 'blueprint', 'agents', `${role}.md`);
    return parseRole(readFileSync(path, 'utf8'), role);
  });
}
