import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAttachmentContextBlock, messageWithContext } from '@main/services/sessions/attachments';
import {
  AUTONOMOUS_RECOVERY_PROMPT,
  agentCommitSubject,
  buildAdditionalUserMessage,
  buildEnvironmentStatus,
  buildFollowUpPrompt,
  buildInitialPrompt,
  buildSteeringMessage,
  renderSystemPrompt,
  titleFromPrompt,
  type PromptPlacement,
} from '@main/services/sessions/prompts';

const placement: PromptPlacement = {
  repoLabel: 'owner/repo',
  repoRoot: '/repo',
  projectRoot: '/repo/lean',
  projectSubdir: 'lean',
  blueprintName: 'sample',
  blueprintTexPath: '/repo/lean/blueprint/src/content.tex',
  leanModule: 'Sample',
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('buildInitialPrompt', () => {
  it('prefixes the first message with placement, environment and the control block', () => {
    const prompt = buildInitialPrompt({
      placement,
      environment: { kind: 'ready' },
      message: 'Prove lemma A',
      attachments: [],
      resumeMessages: [],
      providerResumes: false,
      attachmentContext: null,
    });
    expect(prompt).toBe(
      [
        "You are working on the blueprint 'sample' in owner/repo.",
        'Blueprint LaTeX: /repo/lean/blueprint/src/content.tex',
        'The working directory is the repository root (/repo).',
        "The Lean project root is /repo/lean ('lean' within the repository); run lake and lean commands there.",
        'Repository status: folder is open.',
        'Lean environment status: ready (per-file build errors, if any, are visible in the file tree and via lean_diagnostic_messages).',
        '',
        'CONTROL MESSAGE',
        'target_mode: autonomous',
        'reason: session start',
        'Treat this control message as authoritative mode context.',
        '',
        'User message: Prove lemma A',
      ].join('\n'),
    );
  });

  it('asks for a brief reply first while the build runs and replays a transcript without provider resume', () => {
    const prompt = buildInitialPrompt({
      placement: { ...placement, projectSubdir: '' },
      environment: { kind: 'building' },
      message: 'continue',
      attachments: [],
      resumeMessages: [
        { role: 'user', content: 'first' },
        { role: 'agent', content: 'answer' },
        { role: 'user', content: 'dropped', delivery_state: 'superseded' },
        { role: 'user', content: 'held', delivery_state: 'retained', message_id: 'r1' },
      ],
      providerResumes: false,
      attachmentContext: null,
    });
    expect(prompt).toContain("('.' within the repository)");
    expect(prompt).toContain('still preparing in the background');
    expect(prompt).toContain('\nOn every user turn, first send a brief natural-language reply to the user before using any tools.');
    expect(prompt).toContain('This is a continuation of an earlier chat session.\nUse the transcript below as prior conversation context.\n\nUser: first\nAgent: answer');
    expect(prompt).not.toContain('dropped');
    expect(prompt).toContain('The user sent the messages below before stopping the previous run. Treat them as context for the new message, not as separate requests requiring their own responses.\n\nUser: held');
    expect(prompt.endsWith('\n\nUser message: continue')).toBe(true);
  });

  it('skips the transcript when the provider resumes its own thread', () => {
    const prompt = buildInitialPrompt({
      placement,
      environment: { kind: 'not_built' },
      message: 'continue',
      attachments: [],
      resumeMessages: [{ role: 'user', content: 'first' }],
      providerResumes: true,
      attachmentContext: null,
    });
    expect(prompt).not.toContain('continuation of an earlier chat session');
    expect(prompt).toContain('has not been built yet');
  });
});

describe('per-turn templates', () => {
  it('renders the follow-up, additional and steering messages', () => {
    expect(buildFollowUpPrompt({ kind: 'failed', detail: 'elan missing' }, 'next', [], null)).toBe(
      [
        'Repository status: folder is open.',
        'Lean environment status: toolchain failure (elan missing).',
        'You may still inspect and edit repository files, but Lean/LSP-dependent actions may fail until the environment is repaired.',
        'CONTROL MESSAGE',
        'target_mode: autonomous',
        'reason: follow-up user turn',
        'Treat this control message as authoritative mode context.',
        '',
        'User message: next',
      ].join('\n'),
    );
    expect(buildAdditionalUserMessage('more', [], null)).toBe('User message: more');
    expect(buildSteeringMessage('now', [], null)).toBe(
      'USER MESSAGE (arrived while you were working)\n' +
        'The user sent this during the step you are currently running. Take it into account from here on. It does not by itself mean abandon the current step — judge that from the message.\n\n' +
        'User message: now',
    );
    expect(buildEnvironmentStatus({ kind: 'ready' })).toContain('Lean environment status: ready');
    expect(AUTONOMOUS_RECOVERY_PROMPT.startsWith('CONTROL MESSAGE\ntarget_mode: autonomous\nreason: previous autonomous turn was interrupted')).toBe(true);
  });

  it('renders the attachment block verbatim', () => {
    const block = buildAttachmentContextBlock([
      { id: '1', attachment_kind: 'repo_file', source_id: null, artifact_kind: null, repo_path: 'Sample/Basic.lean', display_name: 'Sample/Basic.lean', selection: { kind: 'line_range', start_line: 3, end_line: 9 }, created_at: 'x' },
      { id: '2', attachment_kind: 'backend_source', source_id: 'src-1', artifact_kind: 'original', repo_path: null, display_name: 'paper.pdf', selection: { kind: 'entire_file' }, created_at: 'x' },
    ]);
    expect(block).toBe(
      [
        'The user attached the following files. Read the parts relevant to their request.',
        '',
        'Attached files:',
        '- File 1:',
        '  - Name: Sample/Basic.lean',
        '  - Source ID: repo_path:Sample/Basic.lean',
        '  - Read with: Read',
        '  - Relevant range: lines 3-9',
        '- File 2:',
        '  - Name: paper.pdf',
        '  - Source ID: source:src-1',
        '  - Read with: Read',
        '',
        'Instructions:',
        '- Treat phrases such as "this file" or "the source" as references to the attached files when the user\'s meaning is otherwise ambiguous.',
        '- Do not expose source IDs, backend object keys, or storage URLs to the user.',
        '- Do not commit attached backend sources or copy them into the repository. Use them only as private context.',
        '- When citing an attached file, use its display name and line, page, or section reference when available.',
      ].join('\n'),
    );
    expect(messageWithContext('hi', [], null)).toBe('hi');
  });
});

describe('renderSystemPrompt', () => {
  it('falls back to the built-in prompt and fills placeholders', () => {
    const prompt = renderSystemPrompt({ promptsDir: '/nonexistent', provider: 'claude' }, placement);
    expect(prompt).toContain('Repository root: /repo');
    expect(prompt).toContain('Lean module for this blueprint: Sample');
    expect(prompt).toContain('# Delegation');
    expect(renderSystemPrompt({ promptsDir: '/nonexistent', provider: 'codex' }, placement)).toContain('# Working alone');
  });

  it('reads the shipped prompt and delegation section from resources/prompts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fuse-prompts-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'prompts'), { recursive: true });
    writeFileSync(join(dir, 'prompts', 'system-prompt.md'), 'Blueprint {blueprint_name} at {blueprint_tex}\n\n{delegation_section}\n\nModule {lean_module} {unknown}');
    writeFileSync(join(dir, 'prompts', 'delegation-claude.md'), '# Delegate with Task\n');
    const prompt = renderSystemPrompt({ promptsDir: join(dir, 'prompts'), provider: 'claude' }, { ...placement, leanModule: null });
    expect(prompt).toBe('Blueprint sample at /repo/lean/blueprint/src/content.tex\n\n# Delegate with Task\n\nModule (not recorded yet; read it from the lakefile) {unknown}');
    writeFileSync(join(dir, 'prompts', 'system-prompt-codex.md'), 'Codex prompt for {blueprint_name}');
    expect(renderSystemPrompt({ promptsDir: join(dir, 'prompts'), provider: 'codex' }, placement)).toBe('Codex prompt for sample');
  });

  it('renders the shipped resources without leaving a known placeholder behind', () => {
    const promptsDir = join(__dirname, '..', '..', '..', '..', 'resources', 'prompts');
    for (const provider of ['claude', 'codex'] as const) {
      const prompt = renderSystemPrompt({ promptsDir, provider }, placement);
      expect(prompt).toContain('Repository root: /repo');
      expect(prompt).not.toMatch(/\{(repo_root|project_root|blueprint_tex|blueprint_name|lean_module|delegation_section)\}/);
    }
  });
});

describe('titles and commit subjects', () => {
  it('derives the history title from the first prompt line', () => {
    expect(titleFromPrompt('\n\n  Prove   lemma A\nthen B')).toBe('Prove lemma A');
    expect(titleFromPrompt('   ')).toBeNull();
    expect(titleFromPrompt('x'.repeat(100))?.length).toBe(80);
  });

  it('builds the agent commit subject', () => {
    expect(agentCommitSubject('Prove\tlemma  A\nmore', false)).toBe('Agent: Prove lemma A');
    expect(agentCommitSubject('', true)).toBe('Agent (incomplete): Update formalization files');
    const long = agentCommitSubject('y'.repeat(100), false);
    expect(long.startsWith('Agent: ')).toBe(true);
    expect(long.length).toBe('Agent: '.length + 72);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('tool names in the prompts', () => {
  it('only name tools the fuse MCP server registers', () => {
    const root = join(__dirname, '..', '..', '..', '..');
    const mcpDirectory = join(root, 'src', 'mcp');
    const registered = new Set(
      readdirSync(mcpDirectory)
        .filter((name) => name.endsWith('-tools.ts') || name === 'tools.ts')
        .flatMap((name) => [...readFileSync(join(mcpDirectory, name), 'utf8').matchAll(/registerTool\(\s*'([a-z_]+)'/g)])
        .map((match) => match[1]),
    );
    expect(registered.size).toBeGreaterThanOrEqual(16);
    // Identifiers that share the tool prefixes but are placeholders or fields.
    const notTools = new Set(['lean_module', 'lean_lib', 'lean_files', 'blueprint_tex', 'blueprint_name', 'blueprint_file']);
    const promptFiles = [join(root, 'src', 'main', 'services', 'sessions', 'prompts.ts')];
    const promptsDir = join(root, 'resources', 'prompts');
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.md') && entry.name !== 'README.md') promptFiles.push(path);
      }
    };
    walk(promptsDir);
    const unknown = new Map<string, string[]>();
    for (const file of promptFiles) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\b(?:mcp__fuse__)?((?:lean_|blueprint_|get_build_|build_)[a-z_]+)\b/g)) {
        const name = match[1];
        if (registered.has(name) || notTools.has(name)) continue;
        unknown.set(name, [...(unknown.get(name) ?? []), file.slice(root.length + 1)]);
      }
    }
    expect(Object.fromEntries(unknown)).toEqual({});
    // The environment status names the real build tool.
    expect(buildEnvironmentStatus({ kind: 'not_built' })).toContain('Run lean_build (or lake build)');
  });
});
