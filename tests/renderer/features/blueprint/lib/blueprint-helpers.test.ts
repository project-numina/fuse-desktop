import { describe, expect, it } from 'vitest';

import {
  blueprintModeUrl,
  buildStatusForPhase,
  formatBlueprintLabel,
  getLeanToolPath,
  getLeanToolPaths,
  isLeanFileWriteToolCall,
  isProjectLeanFile,
  MODE_TO_URL,
  ocrStatusForPhase,
  parseSseEventData,
  URL_TO_MODE,
} from '@/features/blueprint/lib/blueprint-helpers';

describe('blueprint page helpers', () => {
  it('gates Lean services on file type and the selected project, not the browser root', () => {
    expect(isProjectLeanFile('lean/math/Main.lean', 'lean/math')).toBe(true);
    expect(isProjectLeanFile('lean/math/notes.tex', 'lean/math')).toBe(false);
    expect(isProjectLeanFile('lean/math-other/Main.lean', 'lean/math')).toBe(false);
    expect(isProjectLeanFile('Main.lean', '')).toBe(true);
    expect(isProjectLeanFile('Main.lean', undefined)).toBe(false);
    expect(isProjectLeanFile(null, '')).toBe(false);
  });

  it('encodes document names while preserving folder separators and chat context', () => {
    expect(blueprintModeUrl('/workspace', 'view', '?chat=one', 'docs/proof #1.tex')).toBe('/workspace/files/docs/proof%20%231.tex?chat=one');
  });
  it('formats blueprint slugs', () => {
    expect(formatBlueprintLabel('fundamental-theorem-of-calculus')).toBe(
      'fundamental theorem of calculus',
    );
    expect(formatBlueprintLabel('froda')).toBe('froda');
  });

  it('maps public URL names to internal modes and back', () => {
    expect(URL_TO_MODE.blueprint).toBe('edit');
    expect(URL_TO_MODE.lean).toBe('view');
    expect(URL_TO_MODE.files).toBe('view');
    expect(URL_TO_MODE.source).toBe('view');
    expect(URL_TO_MODE.agents).toBe('history');
    expect(MODE_TO_URL.edit).toBe('blueprint');
    expect(MODE_TO_URL.view).toBe('files');
  });

  it('preserves the current query string when switching workspace modes', () => {
    const baseUrl = '/repo/project-numina/numina/blueprint/blueprint-editor';
    const search = '?chat=1aa5490e-5579-4a6b-9558-8dc566cff948&panel=open';

    expect(blueprintModeUrl(baseUrl, 'source', search)).toBe(
      `${baseUrl}/files${search}`,
    );
    expect(blueprintModeUrl(baseUrl, 'history', search)).toBe(
      `${baseUrl}/history${search}`,
    );
    expect(blueprintModeUrl(baseUrl, 'home', search)).toBe(`${baseUrl}${search}`);
    expect(blueprintModeUrl(baseUrl, 'view', search, 'Mathlib/Analysis.lean')).toBe(
      `${baseUrl}/files/Mathlib/Analysis.lean${search}`,
    );
    expect(blueprintModeUrl(baseUrl, 'view', search, null)).toBe(
      `${baseUrl}/files${search}`,
    );
    expect(blueprintModeUrl(baseUrl, 'source', 'chat=conversation-1')).toBe(
      `${baseUrl}/files?chat=conversation-1`,
    );
  });

  it('parses object SSE payloads and rejects malformed or non-object data', () => {
    expect(parseSseEventData({ data: '' } as MessageEvent)).toEqual({});
    expect(parseSseEventData({ data: '{"phase":"complete"}' } as MessageEvent)).toEqual({
      phase: 'complete',
    });
    expect(parseSseEventData({ data: '{not json' } as MessageEvent)).toBeNull();
    expect(parseSseEventData({ data: '[1,2]' } as MessageEvent)).toBeNull();
    expect(parseSseEventData({ data: '"hi"' } as MessageEvent)).toBeNull();
  });

  it('extracts Lean paths from supported tool inputs', () => {
    expect(getLeanToolPath({ file_path: 'Foo.lean', path: 'ignored.lean' })).toBe('Foo.lean');
    expect(getLeanToolPath({ path: 'Bar.lean' })).toBe('Bar.lean');
    expect(getLeanToolPath(null)).toBeNull();
    expect(getLeanToolPath('Foo.lean')).toBeNull();
    expect(getLeanToolPath({ file_path: 42 })).toBeNull();
  });

  it('extracts every path from a Codex FileChange input', () => {
    expect(getLeanToolPaths({ file_path: 'Foo.lean' })).toEqual(['Foo.lean']);
    expect(getLeanToolPaths({
      changes: [
        { path: '/repo/Project/Basic.lean', kind: 'update' },
        { path: '/repo/README.md', kind: 'add' },
        { kind: 'delete' },
        null,
      ],
    })).toEqual(['/repo/Project/Basic.lean', '/repo/README.md']);
    expect(getLeanToolPaths({ changes: 'nope' })).toEqual([]);
    expect(getLeanToolPaths(undefined)).toEqual([]);
  });

  it('recognizes Lean file writes from Claude Code and Codex tool calls', () => {
    expect(isLeanFileWriteToolCall('Write', { file_path: 'Project/Basic.lean' })).toBe(true);
    expect(isLeanFileWriteToolCall('Edit', { file_path: 'Project/Basic.lean' })).toBe(true);
    expect(isLeanFileWriteToolCall('MultiEdit', { file_path: 'Project/Basic.lean' })).toBe(true);
    expect(isLeanFileWriteToolCall('FileChange', {
      changes: [{ path: '/repo/notes.md', kind: 'add' }, { path: '/repo/Project/Basic.lean', kind: 'update' }],
    })).toBe(true);
    // Non-Lean targets, metadata scratch files and read-only tools are ignored.
    expect(isLeanFileWriteToolCall('FileChange', { changes: [{ path: '/repo/notes.md', kind: 'add' }] })).toBe(false);
    expect(isLeanFileWriteToolCall('Write', { file_path: '.metadata/scratch/Try.lean' })).toBe(false);
    expect(isLeanFileWriteToolCall('Read', { file_path: 'Project/Basic.lean' })).toBe(false);
    expect(isLeanFileWriteToolCall('Bash', { command: 'echo > Project/Basic.lean' })).toBe(false);
    expect(isLeanFileWriteToolCall(undefined, { file_path: 'Project/Basic.lean' })).toBe(false);
  });

  it('normalizes build phases while preserving absent updates', () => {
    expect(buildStatusForPhase('complete', null)).toBe('done');
    expect(buildStatusForPhase('up_to_date', 'running')).toBe('done');
    expect(buildStatusForPhase('compiling', null)).toBe('running');
    expect(buildStatusForPhase(null, 'done')).toBe('done');
    expect(buildStatusForPhase(undefined, 'running')).toBe('running');
  });

  it('normalizes OCR phases and clears abandoned scans', () => {
    expect(ocrStatusForPhase('scanning', null)).toBe('scanning');
    expect(ocrStatusForPhase('complete', 'scanning')).toBe('complete');
    expect(ocrStatusForPhase('failed', null)).toBe('failed');
    expect(ocrStatusForPhase('starting', null)).toBe('scanning');
    expect(ocrStatusForPhase('not_needed', 'scanning')).toBeNull();
    expect(ocrStatusForPhase('not_started', 'scanning')).toBeNull();
    expect(ocrStatusForPhase('mystery', 'complete')).toBe('complete');
    expect(ocrStatusForPhase(null, 'scanning')).toBe('scanning');
  });
});
