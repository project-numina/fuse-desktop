/**
 * Workspace deletion (``DELETE .../blueprints/:name``): refuse while an
 * agent turn is live, prune conversations, archive the blueprint's
 * sources, drop the row and its parsed model. Idempotent: a workspace that
 * is already gone is a success. Nothing in the repository folder is touched.
 */

import { promises as fs } from 'node:fs';
import type { AppContext } from '../../server/context';
import { HttpError } from '../../store/registry';
import type { OpenProject } from '../types';
import { sessionService } from './contracts';
import type { SourceService } from '../sources';

export async function deleteWorkspace(ctx: AppContext, project: OpenProject): Promise<void> {
  const { repository, blueprint } = project;
  const sessions = sessionService(ctx);
  const busy =
    sessions?.hasActiveSession?.(repository.id, blueprint.id) ??
    (sessions?.activeSessionsForRepository?.(repository.id) ?? []).some((session) => session.blueprint_name === blueprint.id && session.tier === 'active');
  if (busy) throw new HttpError(409, 'Cannot delete a blueprint with active agent sessions.', 'http_409');

  // Conversations and transcripts belong to the workspace.
  for (const conversation of ctx.registry.listConversations()) {
    if (conversation.repository_id !== repository.id || conversation.blueprint_id !== blueprint.id) continue;
    if (sessions?.deleteConversation) {
      await sessions.deleteConversation(conversation.id);
      continue;
    }
    ctx.registry.deleteConversation(conversation.id);
    await fs.rm(ctx.paths.conversationFile(conversation.id), { force: true }).catch(() => undefined);
  }

  const sources = ctx.services.sources as SourceService | undefined;
  sources?.archiveBlueprintSources(repository.id, blueprint.id);

  ctx.blueprintRooms.delete(project.roomKey);
  if (ctx.registry.getBlueprint(repository.id, blueprint.id)) ctx.registry.deleteBlueprint(repository.id, blueprint.id);
  await fs.rm(ctx.paths.blueprintDir(repository.id, blueprint.id), { recursive: true, force: true }).catch(() => undefined);
  ctx.registry.touchRepository(repository.id);
}
