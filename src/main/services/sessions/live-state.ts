/**
 * Pure derivation of frontend-facing live-session state (port of
 * `services/agent/live_state.py::session_live_state`). The composer reads
 * these fields to decide whether Send and Stop are enabled and which status
 * line to show, so the strings and the truth table are kept verbatim.
 */

import type { BuildStatus, LiveSessionCapabilities, SessionStatus } from '@shared/api-types';

export interface LiveStateSource {
  status: SessionStatus;
  turnActive: boolean;
  userStopRequested: boolean;
  messageAdmissionClosed: boolean;
  hasUserMessageCapacity: boolean;
  buildStatus: BuildStatus;
}

export const TERMINAL_SESSION_STATUSES: ReadonlySet<SessionStatus> = new Set(['completed', 'failed', 'cancelled']);

export function isTerminalStatus(status: SessionStatus): boolean {
  return TERMINAL_SESSION_STATUSES.has(status);
}

export function sessionLiveState(source: LiveStateSource): LiveSessionCapabilities {
  const isActiveSession = source.status === 'starting' || source.status === 'running';
  const canSend =
    source.status === 'running' &&
    !source.userStopRequested &&
    !source.messageAdmissionClosed &&
    source.hasUserMessageCapacity;
  const canCancel = isActiveSession && !source.userStopRequested && !source.messageAdmissionClosed;
  let displayStatus: string;
  if (source.status === 'completed') displayStatus = 'Session complete.';
  else if (source.status === 'failed') displayStatus = 'Session failed.';
  else if (source.status === 'cancelled') displayStatus = 'Session cancelled.';
  else if (source.userStopRequested) displayStatus = 'Stopping.';
  else if (source.messageAdmissionClosed) displayStatus = 'Finishing.';
  else if (source.turnActive) displayStatus = 'Running autonomously.';
  else if (source.buildStatus === 'running') displayStatus = 'Ready for messages. Lean build still running.';
  else if (source.buildStatus === 'failed') displayStatus = 'Ready for messages. Lean build failed.';
  else if (source.status === 'starting') displayStatus = 'Session is starting.';
  else displayStatus = 'Ready for messages.';
  return {
    is_active_session: isActiveSession,
    can_send: canSend,
    can_cancel: canCancel,
    build_status: source.buildStatus,
    display_status: displayStatus,
    active_work_group_count: 0,
    effort_level: 'autonomous',
    api_key_fallback_pending: false,
    api_key_fallback: null,
  };
}
