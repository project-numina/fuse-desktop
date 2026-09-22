/** Blueprint mode for browsing and opening past agent sessions. */

import { HistoryModeView } from './HistoryModeView';
import { useHistoryMode } from './use-history-mode';
import type { HistoryModeProps } from './history-mode-model';

export type { HistoryModeProps, SessionHistorySummary } from './history-mode-model';

/** Stable facade joining the history controller to its presentational view. */
export default function HistoryMode({
  readOnly = false,
  activeSessionId = null,
  currentJobId = null,
  sessionStatus = null,
  ...props
}: HistoryModeProps) {
  const controller = useHistoryMode({
    owner: props.owner,
    repo: props.repo,
    blueprintId: props.blueprintId,
    onSelectSession: props.onSelectSession,
    onNewChat: props.onNewChat,
    activeSessionId,
    currentJobId,
    sessionStatus,
  });
  return (
    <HistoryModeView
      {...controller}
      readOnly={readOnly}
      onNewChat={props.onNewChat}
      className={props.className}
    />
  );
}
