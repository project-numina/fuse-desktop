import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CODEX_ROLE_NAMES = [
  'blueprint', 'blueprint-reviewer', 'formalizer', 'formalizer-reviewer',
  'prover', 'golfer', 'prover-reviewer', 'explorer',
] as const;

export const CODEX_MAX_PARALLEL_AGENTS = 8;

/** Provider-neutral role content ready for Codex agent configuration. */
export interface CodexRoleDefinition {
  name: `fuse:${typeof CODEX_ROLE_NAMES[number]}`;
  description: string;
  developerInstructions: string;
}

export const CODEX_DELEGATION_INSTRUCTIONS = `# Delegation

Launch native Codex agents with spawn_agent(agent_type="fuse:<role>", message=...). The eight roles are fuse:blueprint, fuse:blueprint-reviewer, fuse:formalizer, fuse:formalizer-reviewer, fuse:prover, fuse:golfer, fuse:prover-reviewer, and fuse:explorer.
Keep at most 8 agents active at once across all roles. Track the returned agent IDs; collect results with wait, provide follow-up assignments or reviewer feedback with send_input, and release finished agents with close_agent. A wait timeout is not completion; keep tracking the agent. Close finished agents before opening another slot.
Only the orchestrator may delegate. Subagents cannot launch subagents and must report requests for other roles to the orchestrator.
Use separate writer and reviewer agents for blueprint and formalization work. Forward the reviewer's full feedback to the writer, then review the revision. Each writer/reviewer loop has at most 3 rounds per request; after the third failed review report the remaining issues rather than continuing the loop or claiming approval. Do not replace independent review with self-review.
Give each agent a self-contained message with scope, labels, file paths, blueprint name, relevantDeclarations, hints, and the required result. Agents share the working directory and Fuse MCP tools. Keep dependency analysis, verification, and metadata reconciliation with the orchestrator. Run one prover per declaration and parallelize only independent declarations; preserve other agents' edits.`;

/** Translate shipped Claude tool vocabulary without changing the shared resources. */
export function adaptPromptForCodex(text: string): string {
  return text
    .replace(/Task\(subagent_type=/g, 'spawn_agent(agent_type=')
    .replace(/(spawn_agent\(agent_type=[^\n)]*?), prompt=/g, '$1, message=')
    .replace(/`Task`/g, '`spawn_agent`')
    .replace(/`Read` \(PDFs included\)/g, 'the shell (extract PDF text with an available local utility first)')
    .replace(/`Grep`/g, '`rg` through the shell')
    .replace(/`Glob`/g, '`rg --files` through the shell')
    .replace(/`Read`/g, 'the shell to read files')
    .replace(/`(?:Edit|Write)`/g, '`apply_patch`')
    .replace(/\bEdit\b/g, 'apply_patch')
    .replace(/\bBash\b/g, 'shell');
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
    developerInstructions: `${adaptPromptForCodex(match[2].trim())}\n\n## Delegation boundary\n\nYou are the fuse:${role} subagent, not the orchestrator. Do not launch subagents or call spawn_agent. Complete your assigned role yourself; return any request for another role to the orchestrator. Use the available shell for reading and searching files and apply_patch for file edits, subject to this role's read-only and scope restrictions. Report to the orchestrator in the role's required format.`,
  };
}

/** Read all eight shipped roles; reject missing or malformed resources before launch. */
export function loadCodexRoles(promptsDir: string): CodexRoleDefinition[] {
  return CODEX_ROLE_NAMES.map((role) => {
    const path = join(promptsDir, 'blueprint', 'agents', `${role}.md`);
    return parseRole(readFileSync(path, 'utf8'), role);
  });
}
