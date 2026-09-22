import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatContextAttachmentPayload } from '@shared/api-types';
import { appPaths } from '@main/paths';
import { HttpError } from '@main/server/errors';
import {
  MAX_MESSAGE_CONTEXT_ATTACHMENTS,
  buildAttachmentContextBlock,
  messageWithContext,
  normalizeRepoPath,
  resolveContextAttachments,
  validateSelection,
  type AttachmentContext,
} from '@main/services/sessions/attachments';
import type { Registry } from '@main/store/registry';
import type { RepositorySourceRow } from '@main/store/rows';
import { fakeRepository } from '@test/main/services/sessions/test-helpers';

function expectHttpError(run: () => unknown, status: number, detail: string, code: string): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(HttpError);
  expect(thrown).toMatchObject({ status, detail, code });
}

function source(overrides: Partial<RepositorySourceRow> = {}): RepositorySourceRow {
  return {
    id: 'source-1',
    repository_id: 1,
    display_name: 'paper.pdf',
    source_type: 'pdf',
    status: 'ready',
    artifacts: { original: 'original.pdf', latex: 'latex.tex' },
    metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('validateSelection', () => {
  it('defaults missing selections to the entire file', () => {
    expect(validateSelection(undefined)).toEqual({ kind: 'entire_file' });
    expect(validateSelection(null)).toEqual({ kind: 'entire_file' });
    expect(validateSelection({ kind: 'entire_file' })).toEqual({ kind: 'entire_file' });
  });

  it('accepts inclusive line and page ranges', () => {
    expect(validateSelection({ kind: 'line_range', start_line: 1, end_line: 12 })).toEqual({ kind: 'line_range', start_line: 1, end_line: 12 });
    expect(validateSelection({ kind: 'page_range', start_page: 3, end_page: 3 })).toEqual({ kind: 'page_range', start_page: 3, end_page: 3 });
  });

  it.each([
    ['a primitive', 'line_range', 'selection must be an object'],
    ['an array', [], 'selection must be an object'],
    ['an entire-file range', { kind: 'entire_file', start_line: 1 }, 'entire_file selection takes no range'],
    ['a missing line bound', { kind: 'line_range', start_line: 1 }, 'line_range selection needs start_line and end_line'],
    ['an extra line field', { kind: 'line_range', start_line: 1, end_line: 2, extra: true }, 'line_range selection needs start_line and end_line'],
    ['a zero line', { kind: 'line_range', start_line: 0, end_line: 2 }, 'line_range selection is out of range'],
    ['a fractional line', { kind: 'line_range', start_line: 1.5, end_line: 2 }, 'line_range selection is out of range'],
    ['a reversed line range', { kind: 'line_range', start_line: 4, end_line: 2 }, 'line_range selection is out of range'],
    ['a missing page bound', { kind: 'page_range', start_page: 1 }, 'page_range selection needs start_page and end_page'],
    ['a negative page', { kind: 'page_range', start_page: -1, end_page: 2 }, 'page_range selection is out of range'],
    ['a reversed page range', { kind: 'page_range', start_page: 5, end_page: 2 }, 'page_range selection is out of range'],
    ['an unknown kind', { kind: 'section' }, 'selection.kind must be entire_file, line_range or page_range'],
  ])('rejects %s', (_label, raw, detail) => {
    expectHttpError(() => validateSelection(raw), 422, detail, 'validation_error');
  });
});

describe('normalizeRepoPath', () => {
  it.each([
    [' Lean/Basic.lean ', 'Lean/Basic.lean'],
    ['Lean\\Basic.lean', 'Lean/Basic.lean'],
    ['./Lean/../Main.lean', 'Main.lean'],
    ['nested//file.tex', 'nested/file.tex'],
  ])('normalizes %j', (raw, expected) => {
    expect(normalizeRepoPath(raw)).toBe(expected);
  });

  it.each([
    '', '   ', '.', '..', '../outside', 'folder/../../outside', '/tmp/file', 'C:\\temp\\file',
    '.git/config', 'nested/.git/config', '.lake/build', 'node_modules/pkg/index.js', 'folder/..',
  ])('rejects unsafe or excluded path %j', (raw) => {
    expect(normalizeRepoPath(raw)).toBeNull();
  });
});

describe('resolveContextAttachments', () => {
  const tempDirs: string[] = [];
  let repoRoot: string;
  let getSource: ReturnType<typeof vi.fn>;
  let ctx: AttachmentContext;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'fuse-attachments-'));
    tempDirs.push(root);
    repoRoot = join(root, 'repo');
    mkdirSync(join(repoRoot, 'Lean'), { recursive: true });
    writeFileSync(join(repoRoot, 'Lean', 'Basic.lean'), 'theorem basic : True := by trivial\n');
    getSource = vi.fn(() => source());
    ctx = {
      registry: { getSource } as unknown as Registry,
      paths: appPaths(root),
      repository: fakeRepository(repoRoot),
    };
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('treats an absent list as empty and rejects invalid list shapes and limits', () => {
    expect(resolveContextAttachments(undefined, ctx)).toEqual([]);
    expect(resolveContextAttachments(null, ctx)).toEqual([]);
    expect(resolveContextAttachments([], ctx)).toEqual([]);
    expectHttpError(() => resolveContextAttachments({}, ctx), 422, 'context_attachments must be a list', 'validation_error');
    expectHttpError(
      () => resolveContextAttachments(Array.from({ length: MAX_MESSAGE_CONTEXT_ATTACHMENTS + 1 }, () => ({})), ctx),
      400,
      `Too many context attachments. Maximum is ${MAX_MESSAGE_CONTEXT_ATTACHMENTS} per message.`,
      'http_400',
    );
  });

  it('resolves a repository file with a normalized path and range', () => {
    const [attachment] = resolveContextAttachments([{
      attachment_kind: 'repo_file',
      repo_path: ' ./Lean\\Basic.lean ',
      selection: { kind: 'line_range', start_line: 1, end_line: 1 },
    }], ctx);

    expect(attachment).toEqual({
      id: expect.any(String),
      attachment_kind: 'repo_file',
      source_id: null,
      artifact_kind: null,
      repo_path: 'Lean/Basic.lean',
      display_name: 'Lean/Basic.lean',
      selection: { kind: 'line_range', start_line: 1, end_line: 1 },
      created_at: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(attachment.created_at))).toBe(false);
  });

  it.each([
    ['source fields', { attachment_kind: 'repo_file', repo_path: 'Lean/Basic.lean', source_id: 'source-1' }, 400, 'repo_file attachments cannot reference a source.'],
    ['artifact fields', { attachment_kind: 'repo_file', repo_path: 'Lean/Basic.lean', artifact_kind: 'original' }, 400, 'repo_file attachments cannot reference a source.'],
    ['a missing path', { attachment_kind: 'repo_file' }, 400, 'repo_path is required for repo_file attachments.'],
    ['a blank path', { attachment_kind: 'repo_file', repo_path: ' ' }, 400, 'repo_path is required for repo_file attachments.'],
    ['an invalid path', { attachment_kind: 'repo_file', repo_path: '../secret' }, 400, 'repo_path is invalid.'],
    ['a missing file', { attachment_kind: 'repo_file', repo_path: 'Lean/Missing.lean' }, 404, 'File not found'],
    ['a directory', { attachment_kind: 'repo_file', repo_path: 'Lean' }, 404, 'File not found'],
  ])('rejects repository attachments with %s', (_label, body, status, detail) => {
    expectHttpError(() => resolveContextAttachments([body], ctx), status, detail, `http_${status}`);
  });

  it('does not follow a repository symlink as an attached file', () => {
    symlinkSync(join(repoRoot, 'Lean', 'Basic.lean'), join(repoRoot, 'Lean', 'Alias.lean'));
    expectHttpError(
      () => resolveContextAttachments([{ attachment_kind: 'repo_file', repo_path: 'Lean/Alias.lean' }], ctx),
      404,
      'File not found',
      'http_404',
    );
  });

  it('resolves ready backend sources and defaults to the original artifact', () => {
    const [original, latex] = resolveContextAttachments([
      { attachment_kind: 'backend_source', source_id: 'source-1' },
      { attachment_kind: 'backend_source', source_id: 'source-1', artifact_kind: 'latex', selection: { kind: 'page_range', start_page: 2, end_page: 5 } },
    ], ctx);

    expect(original).toEqual(expect.objectContaining({
      attachment_kind: 'backend_source', source_id: 'source-1', artifact_kind: 'original', repo_path: null,
      display_name: 'paper.pdf', selection: { kind: 'entire_file' },
    }));
    expect(latex).toEqual(expect.objectContaining({
      attachment_kind: 'backend_source', source_id: 'source-1', artifact_kind: 'latex', repo_path: null,
      display_name: 'paper.pdf', selection: { kind: 'page_range', start_page: 2, end_page: 5 },
    }));
    expect(original.id).not.toBe(latex.id);
    expect(original.created_at).toBe(latex.created_at);
    expect(getSource).toHaveBeenCalledTimes(2);
    expect(getSource).toHaveBeenCalledWith(1, 'source-1');
  });

  it.each(['archived', 'deleted', 'deleting'] as const)('hides a %s source', (status) => {
    getSource.mockReturnValue(source({ status }));
    expectHttpError(
      () => resolveContextAttachments([{ attachment_kind: 'backend_source', source_id: 'source-1' }], ctx),
      404,
      'Source not found',
      'http_404',
    );
  });

  it('rejects malformed, missing, unsupported, and unavailable backend sources', () => {
    expectHttpError(
      () => resolveContextAttachments([{ attachment_kind: 'backend_source' }], ctx),
      400,
      'source_id is required for backend_source attachments.',
      'http_400',
    );
    expectHttpError(
      () => resolveContextAttachments([{ attachment_kind: 'backend_source', source_id: 'source-1', repo_path: 'file' }], ctx),
      400,
      'backend_source attachments cannot carry a repo_path.',
      'http_400',
    );
    getSource.mockReturnValueOnce(null);
    expectHttpError(
      () => resolveContextAttachments([{ attachment_kind: 'backend_source', source_id: 'missing' }], ctx),
      404,
      'Source not found',
      'http_404',
    );
    expectHttpError(
      () => resolveContextAttachments([{ attachment_kind: 'backend_source', source_id: 'source-1', artifact_kind: 'html' }], ctx),
      400,
      'Unsupported source artifact kind.',
      'http_400',
    );
    getSource.mockReturnValueOnce(source({ artifacts: { original: 'original.pdf' } }));
    expectHttpError(
      () => resolveContextAttachments([{ attachment_kind: 'backend_source', source_id: 'source-1', artifact_kind: 'ocr' }], ctx),
      400,
      'Requested source artifact is not available.',
      'http_400',
    );
  });

  it('rejects unknown and null attachment bodies', () => {
    expectHttpError(() => resolveContextAttachments([{ attachment_kind: 'image' }], ctx), 422, 'attachment_kind must be backend_source or repo_file', 'validation_error');
    expectHttpError(() => resolveContextAttachments([null], ctx), 422, 'attachment_kind must be backend_source or repo_file', 'validation_error');
  });
});

describe('attachment prompt context', () => {
  const repo = fakeRepository('/repo');
  const backend: ChatContextAttachmentPayload = {
    id: 'a1', attachment_kind: 'backend_source', source_id: 'source-1', artifact_kind: 'latex', repo_path: null,
    display_name: 'paper.tex', selection: { kind: 'page_range', start_page: 2, end_page: 4 }, created_at: 'x',
  };
  const repoFile: ChatContextAttachmentPayload = {
    id: 'a2', attachment_kind: 'repo_file', source_id: null, artifact_kind: null, repo_path: 'Lean/Basic.lean',
    display_name: 'Lean/Basic.lean', selection: { kind: 'line_range', start_line: 7, end_line: 9 }, created_at: 'x',
  };

  it('renders readable source paths, stable identifiers, and relevant ranges', () => {
    const registry = { getSource: vi.fn(() => source()) } as unknown as Registry;
    const paths = appPaths('/data');
    const block = buildAttachmentContextBlock([repoFile, backend], { registry, paths, repository: repo });

    expect(block).toContain('Source ID: repo_path:Lean/Basic.lean');
    expect(block).toContain('Read with: Read\n  - Relevant range: lines 7-9');
    expect(block).toContain('Source ID: source:source-1');
    expect(block).toContain(`Read with: Read ${join(paths.sourcesDir(1), 'source-1', 'latex.tex')}`);
    expect(block).toContain('Relevant range: pages 2-4');
    expect(block).toContain('Do not expose source IDs, backend object keys, or storage URLs');
    expect(registry.getSource).toHaveBeenCalledWith(1, 'source-1');
  });

  it('falls back to generic Read when source context or artifacts are unavailable', () => {
    expect(buildAttachmentContextBlock([backend])).toContain('Read with: Read');
    const noSourceId = { ...backend, source_id: null };
    expect(buildAttachmentContextBlock([noSourceId], { registry: {} as Registry, paths: appPaths('/data'), repository: repo })).toContain('Read with: Read');

    const registry = { getSource: vi.fn(() => null) } as unknown as Registry;
    expect(buildAttachmentContextBlock([backend], { registry, paths: appPaths('/data'), repository: repo })).toContain('Read with: Read');
    const missingArtifactRegistry = { getSource: vi.fn(() => source({ artifacts: { original: 'original.pdf' } })) } as unknown as Registry;
    expect(buildAttachmentContextBlock([backend], { registry: missingArtifactRegistry, paths: appPaths('/data'), repository: repo })).toContain('Read with: Read');
  });

  it('handles empty names, absent selections, and message concatenation', () => {
    expect(buildAttachmentContextBlock([])).toBe('');
    expect(messageWithContext('Question', undefined)).toBe('Question');
    const minimal = { ...repoFile, display_name: null, selection: undefined } as unknown as ChatContextAttachmentPayload;
    const block = buildAttachmentContextBlock([minimal]);
    expect(block).toContain('  - Name: \n');
    expect(block).not.toContain('Relevant range:');
    expect(buildAttachmentContextBlock([{ ...repoFile, selection: { kind: 'entire_file' } }])).not.toContain('Relevant range:');
    expect(messageWithContext('Question', [repoFile])).toBe(`Question\n\n${buildAttachmentContextBlock([repoFile])}`);
  });
});
