import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SubagentScrollPosition } from '@/features/chat/components/subagents/SubagentExpandedView';
import type { ChatApi } from '@/features/chat/state';
import type { SpecialistGrouping } from '@/features/chat/state/specialists';
import type { SubagentStream } from '@/features/chat/state/types';

interface UseExpandedSubagentOptions {
  subagents: SubagentStream[];
  specialists: SpecialistGrouping;
  viewedConversationId: string | null;
  loadSubagentHistory: ChatApi['loadSubagentHistory'];
  onOpenFile?: (filePath: string, line?: number) => void;
}

/** Manages nested subagent drill-down, hydration, focus, and saved scroll state. */
export function useExpandedSubagent({
  subagents,
  specialists,
  viewedConversationId,
  loadSubagentHistory,
  onOpenFile,
}: UseExpandedSubagentOptions) {
  const [expandedSubagentId, setExpandedSubagentId] = useState<string | null>(
    null,
  );
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const scrollPositionsRef = useRef<Map<string, SubagentScrollPosition>>(
    new Map(),
  );

  const expandedSubagent = useMemo<SubagentStream | null>(() => {
    if (!expandedSubagentId) return null;
    return subagents.find(
      (subagent) => subagent.parentToolUseId === expandedSubagentId,
    ) ?? null;
  }, [expandedSubagentId, subagents]);
  const expandedSpecialist = useMemo(() => {
    if (!expandedSubagentId) return null;
    return specialists.groupByRunId.get(expandedSubagentId) ?? null;
  }, [expandedSubagentId, specialists]);
  const expandedChildSubagents = useMemo<SubagentStream[]>(() => {
    if (!expandedSubagentId) return [];
    const owners = new Set(
      expandedSpecialist
        ? expandedSpecialist.members.map((member) => member.parentToolUseId)
        : [expandedSubagentId],
    );
    return subagents.filter(
      (subagent) => subagent.parentSubagentId
        && owners.has(subagent.parentSubagentId),
    );
  }, [expandedSpecialist, expandedSubagentId, subagents]);

  const expandSubagent = useCallback((parentToolUseId: string) => {
    const target = subagents.find(
      (subagent) => subagent.parentToolUseId === parentToolUseId,
    );
    const group = specialists.groupByRunId.get(parentToolUseId);
    for (const member of group?.members ?? []) {
      void loadSubagentHistory(member.parentToolUseId);
    }
    if (!group) void loadSubagentHistory(parentToolUseId);
    if (target?.synthetic === 'explore') return;
    if (!expandedSubagentId && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
    setExpandedSubagentId(parentToolUseId);
  }, [expandedSubagentId, loadSubagentHistory, specialists, subagents]);
  const collapseSubagent = useCallback(() => {
    const parentId = expandedSubagent?.parentSubagentId ?? null;
    setExpandedSubagentId(parentId);
    if (parentId !== null) return;
    requestAnimationFrame(() => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
      returnFocusRef.current = null;
    });
  }, [expandedSubagent]);
  const openFileFromExpandedSubagent = useCallback(
    (filePath: string, line?: number) => {
      setExpandedSubagentId(null);
      onOpenFile?.(filePath, line);
    },
    [onOpenFile],
  );
  const rememberScrollPosition = useCallback(
    (position: SubagentScrollPosition) => {
      if (!expandedSubagentId) return;
      scrollPositionsRef.current.set(expandedSubagentId, position);
    },
    [expandedSubagentId],
  );

  const viewedConversationIdRef = useRef(viewedConversationId);
  useEffect(() => {
    const previous = viewedConversationIdRef.current;
    viewedConversationIdRef.current = viewedConversationId;
    if (previous === viewedConversationId || previous === null) return;
    scrollPositionsRef.current.clear();
    returnFocusRef.current = null;
    setExpandedSubagentId(null);
  }, [viewedConversationId]);

  return {
    collapseSubagent,
    expandSubagent,
    expandedChildSubagents,
    expandedSubagentId,
    expandedSpecialist,
    expandedSubagent,
    initialScroll: expandedSubagent
      ? scrollPositionsRef.current.get(expandedSubagent.parentToolUseId)
      : undefined,
    onOpenFile: onOpenFile ? openFileFromExpandedSubagent : undefined,
    rememberScrollPosition,
  };
}
