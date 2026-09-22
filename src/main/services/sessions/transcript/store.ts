import { existsSync, rmSync } from 'node:fs';
import type { MessageDeliveryState } from '@shared/api-types';
import type { AppPaths } from '../../../paths';
import { JsonFile } from '../../../store/json-file';
import { nowIso, type Registry } from '../../../store/registry';
import type { ConversationFile, ConversationRow, TranscriptRow } from '../../../store/rows';
import type { NativeSessionRef } from '../native-history';
import { historySummary } from './replay';

/** Desktop persistence fields layered over the shared conversation shape. */
export interface StoredConversationFile extends ConversationFile {
  background_started_at: string | null;
  background_reviewed_at: string | null;
  nativeRef?: NativeSessionRef;
  nativeEligible?: boolean;
  hidden?: boolean;
  attentionRevision?: string;
  seenRevision?: string;
  nativeSummary?: { first: string | null; last: string | null; count: number; lastAt: string | null };
  /** In-memory only: rows verified in native history need no durable duplicate. */
  nativeCoveredIds?: string[];
}

function serializeConversation(doc: StoredConversationFile): StoredConversationFile {
  const { nativeCoveredIds, ...saved } = doc;
  if (!doc.nativeRef || !nativeCoveredIds?.length) return saved;
  const covered = new Set(nativeCoveredIds);
  return { ...saved, messages: doc.messages.filter((row) => !covered.has(row.id)) };
}

function migrate(raw: unknown): StoredConversationFile {
  const doc = raw as Partial<StoredConversationFile>;
  return {
    nativeRef: doc.nativeRef,
    nativeEligible: doc.nativeEligible,
    hidden: doc.hidden,
    nativeSummary: doc.nativeSummary,
    attentionRevision: doc.attentionRevision,
    seenRevision: doc.seenRevision,
    row: doc.row as ConversationRow,
    messages: doc.messages ?? [],
    last_persisted_event_id: doc.last_persisted_event_id ?? 0,
    background_started_at: doc.background_started_at ?? null,
    background_reviewed_at: doc.background_reviewed_at ?? null,
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function nativeCoveredIds(doc: StoredConversationFile, native: readonly TranscriptRow[]): string[] {
  const prose = native.filter((row) => row.role !== 'tool');
  const texts = {
    user: prose.filter((row) => row.role === 'user').map((row) => normalizeText(row.content)).join('\n'),
    agent: prose.filter((row) => row.role === 'agent').map((row) => normalizeText(row.content)).join('\n'),
  };
  const cursors = { user: 0, agent: 0 };
  const covered = new Set(doc.nativeCoveredIds ?? []);
  for (const row of doc.messages) {
    if (row.context_attachments.length || row.is_subagent) continue;
    if (row.role === 'user' && row.delivery_state !== null && row.delivery_state !== 'delivered') continue;
    if (row.role === 'tool') {
      const matches = row.tool_use_id
        && native.some((entry) => entry.tool_use_id === row.tool_use_id && entry.event_kind === row.event_kind);
      if (matches) covered.add(row.id);
      continue;
    }
    const body = normalizeText(row.content);
    const position = body ? texts[row.role].indexOf(body, cursors[row.role]) : -1;
    if (position < 0) continue;
    const exactUserMatch = prose.some((entry) => entry.role === 'user' && normalizeText(entry.content) === body);
    if (row.role !== 'user' || exactUserMatch) covered.add(row.id);
    cursors[row.role] = position + body.length;
  }
  return [...covered];
}

function checkpointSummary(doc: StoredConversationFile): void {
  doc.nativeSummary = undefined;
  const summary = historySummary(doc, null);
  doc.nativeSummary = {
    first: summary.first_message,
    last: summary.last_message,
    count: summary.message_count,
    lastAt: summary.last_message_at,
  };
}

/** File-backed conversation persistence with native-history deduplication. */
export class ConversationStore {
  private readonly files = new Map<string, JsonFile<StoredConversationFile>>();

  constructor(
    private readonly paths: AppPaths,
    private readonly registry: Registry,
  ) {}

  private file(id: string): JsonFile<StoredConversationFile> | null {
    const cached = this.files.get(id);
    if (cached) return cached;
    if (!existsSync(this.paths.conversationFile(id))) return null;
    const file = new JsonFile<StoredConversationFile>(
      this.paths.conversationFile(id),
      () => { throw new Error(`Conversation ${id} has no file`); },
      migrate,
      serializeConversation,
    );
    this.files.set(id, file);
    return file;
  }

  create(row: ConversationRow, extras: { background_started_at?: string | null } = {}): StoredConversationFile {
    const doc: StoredConversationFile = {
      row,
      messages: [],
      last_persisted_event_id: 0,
      background_started_at: extras.background_started_at ?? null,
      background_reviewed_at: null,
    };
    const file = new JsonFile<StoredConversationFile>(
      this.paths.conversationFile(row.id), () => doc, migrate, serializeConversation,
    );
    file.set(doc);
    this.files.set(row.id, file);
    this.registry.upsertConversation(row);
    return doc;
  }

  get(id: string): StoredConversationFile | null {
    return this.file(id)?.get() ?? null;
  }

  /** Merge provider-owned rows in memory while retaining unmatched Fuse-only work. */
  hydrateNative(id: string, native: TranscriptRow[]): StoredConversationFile {
    const doc = this.get(id);
    if (!doc) throw new Error('Conversation not found');
    const covered = new Set(doc.nativeCoveredIds ?? []);
    const supplemental = doc.messages.filter((row) => !covered.has(row.id));
    const nativeIds = new Set(native.map((row) => row.id));
    const merged = new Set<string>();
    const messages = native.map((entry) => {
      if (entry.role !== 'user') return entry;
      const original = supplemental.find((row) => row.role === 'user' && !merged.has(row.id)
        && (row.delivery_state === null || row.delivery_state === 'delivered')
        && row.content.trim() && entry.content.includes(row.content));
      if (!original) return entry;
      merged.add(original.id);
      return { ...original, created_at: entry.created_at, delivered_at: null };
    });
    doc.messages = [...messages, ...supplemental.filter((row) => !nativeIds.has(row.id) && !merged.has(row.id))];
    doc.nativeCoveredIds = [...nativeIds];
    doc.nativeSummary = undefined;
    return doc;
  }

  /** Remove durable duplicates only after matching them against provider history. */
  checkpointNative(id: string, ref: NativeSessionRef, native: TranscriptRow[]): void {
    if (!native.length) return;
    this.update(id, (doc) => {
      doc.nativeCoveredIds = nativeCoveredIds(doc, native);
      checkpointSummary(doc);
      doc.nativeRef = ref;
    });
  }

  has(id: string): boolean {
    return this.file(id) !== null;
  }

  update(id: string, mutate: (doc: StoredConversationFile) => void): StoredConversationFile {
    const file = this.file(id);
    if (!file) throw new Error(`Conversation ${id} has no file`);
    file.update(mutate);
    this.registry.upsertConversation(file.get().row);
    return file.get();
  }

  updateRow(id: string, patch: Partial<ConversationRow>): ConversationRow {
    return this.update(id, (doc) => {
      doc.row = { ...doc.row, ...patch, updated_at: nowIso() };
    }).row;
  }

  appendRow(id: string, row: TranscriptRow, boundaryEventId: number | null = null): void {
    const file = this.file(id);
    if (!file) throw new Error(`Conversation ${id} has no file`);
    file.update((doc) => {
      doc.nativeSummary = undefined;
      doc.messages.push(row);
      if (boundaryEventId !== null) {
        doc.last_persisted_event_id = Math.max(doc.last_persisted_event_id, boundaryEventId);
      }
      doc.row.updated_at = nowIso();
    });
    this.registry.upsertConversation(file.get().row);
  }

  setLastPersistedEventId(id: string, eventId: number): void {
    const file = this.file(id);
    if (!file) return;
    file.update((doc) => {
      doc.last_persisted_event_id = Math.max(doc.last_persisted_event_id, eventId);
    });
  }

  setDeliveryState(
    id: string,
    messageId: string,
    state: MessageDeliveryState,
    options: { preserveDeliveredAt?: boolean } = {},
  ): TranscriptRow | null {
    const file = this.file(id);
    if (!file) return null;
    let updated: TranscriptRow | null = null;
    file.update((doc) => {
      const row = doc.messages.find((entry) => entry.id === messageId);
      if (!row) return;
      row.delivery_state = state;
      if (!options.preserveDeliveredAt) {
        row.delivered_at = state === 'delivered' || state === 'steered' || state === 'retained' ? nowIso() : null;
      }
      updated = row;
    });
    return updated;
  }

  async settled(id: string): Promise<void> {
    await this.file(id)?.settled();
  }

  flushSync(): void {
    for (const file of this.files.values()) file.flushSync();
  }

  delete(id: string): void {
    const file = this.files.get(id);
    this.files.delete(id);
    try {
      file?.flushSync();
    } catch {
      // The file may already be gone.
    }
    rmSync(this.paths.conversationFile(id), { force: true });
    this.registry.deleteConversation(id);
  }
}
