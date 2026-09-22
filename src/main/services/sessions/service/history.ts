import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  PendingResumeDiscardResponse, RecentConversationSummary,
  RepositoryBackgroundSessionResponse, SessionHistoryDetail,
  SessionHistorySummary, SubagentHistoryDetail,
} from '@shared/api-types';
import type { SessionAttention } from '@shared/session-attention';
import { HttpError } from '../../../server/errors';
import { nowIso } from '../../../store/registry';
import type { ConversationRow, RepositoryRow } from '../../../store/rows';
import type { OpenProject } from '../../types';
import { canonicalDirectory, type NativeSession, type NativeSessionRef } from '../native-history';
import { SessionServiceCore } from './core';
import {
  MAX_DISPLAYED_PROGRESS_ENTRIES, attentionRevision, historyDetail,
  historySummary, isUnread, subagentTimeline, type StoredConversationFile,
} from '../transcript';

/** Durable history, native-provider discovery, and attention projection. */
export abstract class SessionHistoryService extends SessionServiceCore {
  activeSessionsForRepository(repositoryId: number): RepositoryBackgroundSessionResponse[] {
    const out: RepositoryBackgroundSessionResponse[] = [];
    const rows = this.ctx.registry.listConversations()
      .filter((row) => row.repository_id === repositoryId)
      .filter((row) => !this.store.get(row.id)?.hidden)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 100);
    for (const row of rows) {
      if (out.length >= 3) break;
      const doc = this.store.get(row.id);
      if (!doc) continue;
      const summary = historySummary(doc, this.liveInfo(this.liveByConversation.get(row.id)));
      out.push({
        id: row.id, blueprint_name: row.blueprint_id ?? 'workspace', title: row.title,
        tier: summary.tier, updated_at: row.updated_at,
        background_updates: summary.background_updates.slice(0, MAX_DISPLAYED_PROGRESS_ENTRIES),
        roadblocks: summary.roadblocks.slice(0, MAX_DISPLAYED_PROGRESS_ENTRIES),
      });
    }
    return out;
  }

  nativeHistoryWarnings(owner: string, repo: string, blueprint: string): string[] {
    return this.historyWarnings.get(`${owner}/${repo}/${blueprint}`) ?? [];
  }

  nativeHistoryRefreshing(owner: string, repo: string, blueprint: string): boolean {
    return this.nativeDiscovery.has(`${owner}/${repo}/${blueprint}`);
  }

  private async discoverNative(owner: string, repo: string, blueprintName: string): Promise<void> {
    if (!this.nativeHistory) return;
    const key = `${owner}/${repo}/${blueprintName}`;
    const pending = this.nativeDiscovery.get(key);
    if (pending) return pending;
    const project = this.openProject(owner, repo, blueprintName);
    const work = (async () => {
      const result = await this.nativeHistory!.list([project.clonePath, project.projectRoot]);
      this.historyWarnings.set(key, result.errors);
      const allowed = new Set([project.clonePath, project.projectRoot].map(canonicalDirectory));
      for (const native of result.sessions) {
        if (!allowed.has(canonicalDirectory(native.directory))) continue;
        this.mergeNativeSession(key, blueprintName, project, native);
      }
    })().catch(() => {
      this.historyWarnings.set(key, ['Native history is unavailable. Existing Fuse chats are still available.']);
    });
    this.nativeDiscovery.set(key, work);
    try {
      await work;
    } finally {
      this.nativeDiscovery.delete(key);
      this.syncAttention();
    }
  }

  private mergeNativeSession(key: string, blueprintName: string, project: OpenProject, native: NativeSession): void {
    const existing = this.ctx.registry.listConversations().find((row) =>
      row.repository_id === project.repository.id && row.blueprint_id === blueprintName
      && row.provider === native.provider && row.provider_thread_id === native.threadId);
    if (existing) {
      const doc = this.store.get(existing.id);
      if (doc?.nativeRef && !this.liveByConversation.get(existing.id)) {
        this.store.update(existing.id, (draft) => {
          if (native.updatedAt > draft.row.updated_at) draft.attentionRevision = `native:${native.updatedAt}`;
          draft.row.updated_at = native.updatedAt;
          draft.row.title = native.title || draft.row.title;
        });
      }
      return;
    }
    const id = `native-${createHash('sha256').update(`${key}\0${native.provider}\0${native.threadId}`).digest('hex').slice(0, 32)}`;
    this.store.create({
      id, repository_id: project.repository.id, blueprint_id: blueprintName,
      title: native.title || 'Untitled chat', status: 'completed', created_at: native.createdAt,
      updated_at: native.updatedAt, completed_at: native.updatedAt, input_tokens: null,
      output_tokens: null, total_cost_usd: null, provider_thread_id: native.threadId,
      provider: native.provider, tier: 'completed', background_updates: [], roadblocks: [],
    });
    this.store.update(id, (doc) => {
      doc.nativeEligible = true;
      doc.nativeRef = { provider: native.provider, threadId: native.threadId, directory: native.directory };
      doc.background_reviewed_at = native.updatedAt;
      doc.attentionRevision = `native:${native.updatedAt}`;
      doc.seenRevision = doc.attentionRevision;
    });
  }

  attentionState(): SessionAttention[] {
    return this.ctx.registry.listConversations().flatMap((row) => {
      const doc = this.store.get(row.id);
      const repo = this.ctx.registry.getRepositoryById(row.repository_id);
      if (!doc || doc.hidden || !repo) return [];
      const live = this.liveByConversation.get(row.id);
      const state: SessionAttention['state'] = live?.pendingPermissionIds.size ? 'needs_input'
        : live && !live.isTerminal && (live.turnActive || live.pendingCount > 0 || live.status === 'starting') ? 'running'
          : row.status === 'failed' ? 'error' : 'idle';
      return [{
        id: row.id, owner: repo.owner, repository: repo.name, blueprint: row.blueprint_id,
        revision: attentionRevision(doc), unread: isUnread(doc), state,
      }];
    });
  }

  markSeen(conversationId: string, revision: string): void {
    const doc = this.store.get(conversationId);
    if (!doc || doc.hidden) throw new HttpError(404, 'Session history not found', 'http_404');
    const live = this.liveByConversation.get(conversationId);
    if (attentionRevision(doc) !== revision || (live && !live.isTerminal && (live.turnActive || live.pendingCount > 0))) {
      throw new HttpError(409, 'A newer response is still unread.', 'http_409');
    }
    this.store.update(conversationId, (draft) => {
      draft.attentionRevision = revision;
      draft.seenRevision = revision;
      draft.background_reviewed_at = nowIso();
      draft.row.tier = 'completed';
    });
    this.syncAttention();
  }

  protected async historyDocument(id: string): Promise<StoredConversationFile | null> {
    const doc = this.store.get(id);
    if (!doc || doc.hidden) return null;
    const live = this.liveByConversation.get(id);
    if (!doc.nativeRef || (live && !live.isTerminal)) return doc;
    if (!this.nativeHistory) throw new HttpError(503, 'Native history is unavailable. Check Settings → Agents.', 'http_503');
    try {
      const messages = await this.nativeHistory.read(doc.nativeRef);
      if (!messages.length) throw new Error('Empty or missing native session');
      const base = Date.parse(doc.row.created_at) || 0;
      messages.forEach((row, index) => { row.created_at = new Date(base + index).toISOString(); });
      this.store.checkpointNative(id, doc.nativeRef, messages);
      return this.store.hydrateNative(id, messages);
    } catch {
      throw new HttpError(503, 'The provider’s saved chat could not be read. Check that its native session still exists and its CLI is available. No history was deleted.', 'http_503');
    }
  }

  protected async checkpointNative(id: string): Promise<void> {
    const doc = this.store.get(id);
    if (!this.nativeHistory || !doc?.nativeEligible || !doc.row.provider_thread_id) return;
    const repository = this.ctx.registry.getRepositoryById(doc.row.repository_id);
    if (!repository) return;
    const ref: NativeSessionRef = doc.nativeRef?.threadId === doc.row.provider_thread_id && doc.nativeRef.provider === doc.row.provider
      ? doc.nativeRef
      : { provider: doc.row.provider, threadId: doc.row.provider_thread_id, directory: repository.path };
    try {
      const rows = await this.nativeHistory.read(ref);
      const current = this.store.get(id);
      if (!current || current.hidden || current.row.provider_thread_id !== ref.threadId || this.liveByConversation.get(id)?.turnActive) return;
      this.store.checkpointNative(id, ref, rows);
    } catch {
      // Preserve the fallback transcript until native history is readable.
    }
  }

  async listHistory(owner: string, repo: string, blueprintName: string, limit: number, offset: number, refreshNative = true): Promise<SessionHistorySummary[]> {
    const repository = this.ctx.registry.getRepository(owner, repo);
    if (!repository) return [];
    if (refreshNative && offset === 0) void this.discoverNative(owner, repo, blueprintName).catch(() => {});
    return this.ctx.registry.listConversations()
      .filter((row) => row.repository_id === repository.id && row.blueprint_id === blueprintName)
      .filter((row) => !this.store.get(row.id)?.hidden)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(offset, offset + limit)
      .map((row) => this.store.get(row.id))
      .filter((doc): doc is StoredConversationFile => doc !== null)
      .map((doc) => ({ ...historySummary(doc, this.liveInfo(this.liveByConversation.get(doc.row.id))), provider: doc.row.provider }));
  }

  recentConversations(limit: number, offset: number): RecentConversationSummary[] {
    const rows = this.ctx.registry.listConversations()
      .filter((row) => !this.store.get(row.id)?.hidden)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((row) => ({ row, repository: this.ctx.registry.getRepositoryById(row.repository_id) }))
      .filter((entry): entry is { row: ConversationRow; repository: RepositoryRow } => entry.repository !== null)
      .slice(offset, offset + limit);
    return rows.map(({ row, repository }) => {
      const doc = this.store.get(row.id);
      const summary = doc
        ? historySummary(doc, this.liveInfo(this.liveByConversation.get(row.id)), { includeLegacyBackgroundProgress: false })
        : emptySummary(row);
      return { ...summary, repository_owner: repository.owner, repository_name: repository.name };
    });
  }

  async historyDetail(conversationId: string): Promise<SessionHistoryDetail> {
    const doc = await this.historyDocument(conversationId);
    if (!doc) throw new HttpError(404, 'Session history not found', 'http_404');
    return historyDetail(doc, this.liveInfo(this.liveByConversation.get(conversationId)), { initialOnly: true });
  }

  async subagentHistory(conversationId: string, parentToolUseId: string): Promise<SubagentHistoryDetail> {
    const doc = await this.historyDocument(conversationId);
    if (!doc) throw new HttpError(404, 'Session history not found', 'http_404');
    return subagentTimeline(doc, parentToolUseId);
  }

  async reviewBackground(conversationId: string): Promise<SessionHistoryDetail> {
    const doc = await this.historyDocument(conversationId);
    if (!doc) throw new HttpError(404, 'Session history not found', 'http_404');
    const live = this.liveByConversation.get(conversationId);
    if (live && !live.isTerminal && (live.turnActive || live.pendingCount > 0)) {
      throw new HttpError(409, 'Background session is still running.', 'http_409');
    }
    this.markSeen(conversationId, attentionRevision(doc));
    const updated = this.store.get(conversationId)!;
    const liveInfo = this.liveInfo(live);
    this.store.updateRow(conversationId, { tier: historySummary(updated, liveInfo).tier });
    return historyDetail(this.store.get(conversationId) as StoredConversationFile, liveInfo, { initialOnly: false });
  }

  async deleteHistory(conversationId: string): Promise<void> {
    const doc = this.store.get(conversationId);
    if (!doc) throw new HttpError(404, 'Session history not found', 'http_404');
    const live = this.liveByConversation.get(conversationId);
    if (live && !live.isTerminal) {
      await this.cancel(live.sessionId);
      if (!live.isTerminal) {
        void this.threads.get(live.sessionId)?.close();
        await Promise.race([live.terminal, new Promise((resolveWait) => setTimeout(resolveWait, this.options.stopWaitMs))]);
      }
      if (!live.isTerminal) throw new HttpError(409, 'Session is still stopping. Try deleting again.', 'http_409');
    }
    if (doc.nativeRef) {
      this.store.update(conversationId, (draft) => { draft.hidden = true; });
      this.syncAttention();
      return;
    }
    this.store.delete(conversationId);
    this.syncAttention();
    rmSync(join(this.ctx.paths.dataDir, 'prompts', conversationId), { recursive: true, force: true });
  }

  discardPendingResume(conversationId: string): PendingResumeDiscardResponse {
    this.store.get(conversationId);
    return { status: 'discarded', discarded: 0 };
  }
}

function emptySummary(row: ConversationRow): SessionHistorySummary {
  return {
    id: row.id, title: row.title, status: row.status,
    workspace_id: row.blueprint_id, workspace_display_name: row.blueprint_id,
    blueprint_name: row.blueprint_id, created_at: row.created_at, completed_at: row.completed_at,
    background_started_at: null, background_reviewed_at: null,
    input_tokens: row.input_tokens, output_tokens: row.output_tokens,
    total_cost_usd: row.total_cost_usd, message_count: 0,
    first_message: null, last_message: null, last_message_at: null,
    tier: row.tier, background_updates: row.background_updates, roadblocks: row.roadblocks,
  };
}
