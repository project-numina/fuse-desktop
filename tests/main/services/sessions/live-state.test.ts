import { describe, expect, it } from 'vitest';
import { sessionLiveState, type LiveStateSource } from '@main/services/sessions/live-state';

function source(overrides: Partial<LiveStateSource> = {}): LiveStateSource {
  return {
    status: 'running',
    turnActive: false,
    userStopRequested: false,
    messageAdmissionClosed: false,
    hasUserMessageCapacity: true,
    buildStatus: 'not_started',
    ...overrides,
  };
}

describe('sessionLiveState', () => {
  it('lets an idle running session send and cancel', () => {
    expect(sessionLiveState(source())).toMatchObject({
      is_active_session: true,
      can_send: true,
      can_cancel: true,
      display_status: 'Ready for messages.',
      build_status: 'not_started',
      effort_level: 'autonomous',
      api_key_fallback_pending: false,
      api_key_fallback: null,
      active_work_group_count: 0,
    });
  });

  it('closes the live controls when the session is finishing', () => {
    expect(sessionLiveState(source({ messageAdmissionClosed: true }))).toMatchObject({
      can_send: false,
      can_cancel: false,
      display_status: 'Finishing.',
    });
  });

  it('accepts queued steering during an active turn', () => {
    expect(sessionLiveState(source({ turnActive: true }))).toMatchObject({
      can_send: true,
      can_cancel: true,
      display_status: 'Running autonomously.',
    });
  });

  it('disables sends when the follow-up queue is full', () => {
    expect(sessionLiveState(source({ hasUserMessageCapacity: false })).can_send).toBe(false);
  });

  it('closes the controls the moment a stop is requested', () => {
    expect(sessionLiveState(source({ userStopRequested: true, turnActive: true }))).toMatchObject({
      can_send: false,
      can_cancel: false,
      display_status: 'Stopping.',
    });
  });

  it('reports the build while idle and the terminal statuses', () => {
    expect(sessionLiveState(source({ buildStatus: 'running' })).display_status).toBe('Ready for messages. Lean build still running.');
    expect(sessionLiveState(source({ buildStatus: 'failed' })).display_status).toBe('Ready for messages. Lean build failed.');
    expect(sessionLiveState(source({ status: 'starting' }))).toMatchObject({ can_send: false, can_cancel: true, display_status: 'Session is starting.' });
    expect(sessionLiveState(source({ status: 'completed' }))).toMatchObject({ is_active_session: false, can_send: false, can_cancel: false, display_status: 'Session complete.' });
    expect(sessionLiveState(source({ status: 'failed' })).display_status).toBe('Session failed.');
    expect(sessionLiveState(source({ status: 'cancelled' })).display_status).toBe('Session cancelled.');
  });
});
