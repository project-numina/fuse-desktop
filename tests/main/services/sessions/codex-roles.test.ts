import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  adaptPromptForCodex,
  CODEX_MAX_PARALLEL_AGENTS,
  CODEX_DELEGATION_INSTRUCTIONS,
  CODEX_LEAN_RESOURCE_INSTRUCTIONS,
  CODEX_ROLE_NAMES,
  loadCodexRoles,
} from '@main/services/sessions/codex-roles';

const promptsDir = join(__dirname, '..', '..', '..', '..', 'resources', 'prompts');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(blueprint: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fuse-codex-roles-'));
  dirs.push(dir);
  const agents = join(dir, 'blueprint', 'agents');
  mkdirSync(agents, { recursive: true });
  for (const role of CODEX_ROLE_NAMES) {
    writeFileSync(join(agents, `${role}.md`), role === 'blueprint' ? blueprint : `---\nname: ${role}\ndescription: Test role\n---\nRole body.`);
  }
  return dir;
}

describe('loadCodexRoles', () => {
  it('gives the orchestrator and every child the same verification coordination rules', () => {
    expect(CODEX_DELEGATION_INSTRUCTIONS).toContain(CODEX_LEAN_RESOURCE_INSTRUCTIONS);
    for (const role of loadCodexRoles(promptsDir)) {
      expect(role.developerInstructions).toContain(CODEX_LEAN_RESOURCE_INSTRUCTIONS);
      expect(role.developerInstructions).toContain('take precedence over verification steps');
    }
  });
  it('loads exactly eight native role configurations from the shared bodies', () => {
    const roles = loadCodexRoles(promptsDir);
    expect(roles.map((role) => role.name)).toEqual(CODEX_ROLE_NAMES.map((name) => `fuse:${name}`));
    expect(roles).toHaveLength(CODEX_MAX_PARALLEL_AGENTS);
    for (const role of roles) {
      expect(Object.keys(role).sort()).toEqual(['description', 'developerInstructions', 'name']);
      const source = readFileSync(join(promptsDir, 'blueprint', 'agents', `${role.name.slice(5)}.md`), 'utf8');
      const body = source.split('---').slice(2).join('---').trim();
      expect(role.developerInstructions).toContain(adaptPromptForCodex(body));
      expect(role.developerInstructions).toContain('Do not launch subagents or call spawn_agent');
      expect(role.developerInstructions).not.toMatch(/permissionMode|model:|\bopus\b|\bsonnet\b|`(?:Task|Read|Write|Edit|Grep|Glob)`|\bBash\b/);
    }
    expect(roles.find((role) => role.name === 'fuse:blueprint-reviewer')?.developerInstructions).toContain('you never edit anything');
    expect(roles.find((role) => role.name === 'fuse:prover')?.developerInstructions).toContain('Re-read the main `.lean` file right before editing');
    expect(roles.find((role) => role.name === 'fuse:explorer')?.developerInstructions).toContain('Never `apply_patch` or `apply_patch` a `.tex` or `.lean` file');
  });

  it('parses quoted scalar metadata and CRLF, ignoring Claude-only frontmatter', () => {
    const dir = fixture('\uFEFF---\r\nname: "blueprint"\r\ndescription: \'A role: with punctuation\'\r\nmodel: opus\r\npermissionMode: acceptEdits\r\n---\r\nUse `Edit`.\r\n');
    const role = loadCodexRoles(dir)[0];
    expect(role.name).toBe('fuse:blueprint');
    expect(role.description).toBe('A role: with punctuation');
    expect(role.developerInstructions).toContain('Use `apply_patch`.');
    expect(role.developerInstructions).not.toContain('acceptEdits');
    writeFileSync(join(dir, 'blueprint', 'agents', 'blueprint.md'), '---\nname: blueprint\ndescription: Updated\n---\nChanged body.');
    expect(loadCodexRoles(dir)[0].description).toBe('Updated');
  });

  it.each([
    'No frontmatter',
    '---\nname: prover\ndescription: Wrong name\n---\nBody',
    '---\nname: blueprint\n---\nBody',
    '---\nname: blueprint\ndescription: ""\n---\nBody',
    '---\nname: blueprint\ndescription: >\n  Multiline is unsupported\n---\nBody',
    '---\nname: blueprint\ndescription: Valid\n---\n  ',
    '---\nname: blueprint\nname: blueprint\ndescription: Duplicate\n---\nBody',
  ])('rejects invalid role resources: %s', (source) => {
    expect(() => loadCodexRoles(fixture(source))).toThrow('Invalid Codex role blueprint');
  });

  it('fails when a required role resource is missing', () => {
    const dir = fixture('---\nname: blueprint\ndescription: Valid\n---\nBody');
    rmSync(join(dir, 'blueprint', 'agents', 'prover.md'));
    expect(() => loadCodexRoles(dir)).toThrow();
  });
});

describe('adaptPromptForCodex', () => {
  it('adapts tools and delegation arguments while preserving MCP names and math', () => {
    const adapted = adaptPromptForCodex('`Task(subagent_type="fuse:prover", prompt=...)`; `Task`; `Grep`; `Glob`; `Read` (PDFs included); `Write`; Edit; **Bash**; mcp__fuse__lean_goal; \\uses{lem:a}');
    expect(adapted).toContain('spawn_agent(task_name="role_task", agent_type="fuse:prover", message=...)');
    expect(adapted).toContain('extract PDF text with an available local utility first');
    expect(adapted).toContain('`rg --files` through the shell');
    expect(adapted).toContain('mcp__fuse__lean_goal; \\uses{lem:a}');
    expect(adaptPromptForCodex(adapted)).toBe(adapted);
  });

  it('preserves ordinary prose and only adapts explicit tool references', () => {
    const prose = 'Edit only your own declaration. Discuss Bash syntax and the editorial policy.';
    expect(adaptPromptForCodex(prose)).toBe(prose);
    expect(adaptPromptForCodex('Use `Edit`, **Bash**, or the Bash tool; run through Bash.')).toBe('Use `apply_patch`, shell, or the shell tool; run through shell.');
  });
});
