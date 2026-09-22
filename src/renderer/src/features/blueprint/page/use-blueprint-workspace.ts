import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useChat } from '@/state/chat';

import type { BlueprintRouteIdentity } from './blueprint-page-types';
import { useBlueprintChatRouting } from './use-blueprint-chat-routing';
import { useBlueprintEditing } from './use-blueprint-editing';
import { useBlueprintFiles } from './use-blueprint-files';
import { useBlueprintLoader } from './use-blueprint-loader';
import { useBlueprintModeRouting } from './use-blueprint-mode-routing';
import { useBlueprintRefresh } from './use-blueprint-refresh';
import { useRepositorySources } from './use-repository-sources';

export function useBlueprintWorkspace(route: BlueprintRouteIdentity) {
  const chat = useChat();
  const [searchParams, setSearchParams] = useSearchParams();
  const loader = useBlueprintLoader(route, chat.state.sessionId);
  const modeRouting = useBlueprintModeRouting(route);
  const editing = useBlueprintEditing({
    route,
    blueprint: loader.blueprint,
    blueprintRef: loader.blueprintRef,
    setBlueprint: loader.setBlueprint,
  });
  const setLeanDirty = editing.setLeanDirty;
  const markLeanDirty = useCallback(() => setLeanDirty(true), [setLeanDirty]);
  const files = useBlueprintFiles({
    route,
    baseUrl: modeRouting.baseUrl,
    mode: modeRouting.mode,
    modeParam: modeRouting.modeParam,
    blueprint: loader.blueprint,
    isReadonly: !loader.canEdit,
    onDirty: markLeanDirty,
  });
  const sources = useRepositorySources({
    route,
    baseUrl: modeRouting.baseUrl,
    repositoryFileSearch: files.repositoryFileSearch,
    referenceParam: files.referenceParam,
    sourceMounted: modeRouting.mountedModes.has('view'),
    openFile: files.openFile,
  });
  const refresh = useBlueprintRefresh({
    route, loader, modeRouting, editing, files, sources,
  });
  const chatRouting = useBlueprintChatRouting({
    chat,
    isReadonly: !loader.canEdit,
    searchParams,
    setSearchParams,
  });

  return { route, chat, loader, modeRouting, editing, files, sources, refresh, chatRouting };
}

export type BlueprintWorkspaceController = ReturnType<typeof useBlueprintWorkspace>;
