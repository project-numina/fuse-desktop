import { describe, expect, it, vi } from 'vitest';

import { createBuildState } from '@/features/chat/state/build-state';
import { createInitialChatState } from '@/features/chat/state/message-state';

const event = (data: unknown): Event => ({
  data: JSON.stringify(data),
}) as unknown as Event;

function setup(currentTurnId: () => string | null = () => 'turn-0') {
  const state = createInitialChatState();
  const emit = vi.fn();
  const updateLiveBuildStatus = vi.fn();
  const scrollToLatest = vi.fn();
  const controller = createBuildState({
    state,
    emit,
    currentTurnId,
    updateLiveBuildStatus,
    scrollToLatest,
  });
  return {
    controller,
    emit,
    scrollToLatest,
    state,
    updateLiveBuildStatus,
  };
}

describe('live build state', () => {
  it('replaces build steps from an authoritative snapshot', () => {
    const { controller, state, updateLiveBuildStatus } = setup();
    controller.handleSnapshot(event({
      status: 'done',
      steps: [
        { phase: 'preparing' },
        { phase: 'not_visible' },
        { phase: 'building' },
      ],
    }));
    expect(state.buildHistory[0]).toMatchObject({
      status: 'done',
      turnId: 'turn-0',
      steps: [
        { label: 'Preparing workspace', status: 'done' },
        { label: 'Building Lean environment', status: 'done' },
      ],
    });
    expect(updateLiveBuildStatus).toHaveBeenCalledWith('done');
  });

  it('buffers setup phases until substantive work appears and resets cleanly', () => {
    const { controller, state } = setup(() => null);
    controller.handleStatus(event({ phase: 'fetching' }));
    expect(state.buildHistory).toEqual([]);
    controller.handleStatus(event({ phase: 'building' }));
    expect(state.buildHistory[0].steps[0]).toEqual({
      label: 'Updating project files', status: 'done',
    });
    controller.reset();
    controller.finishLastStep();
    expect(state.buildHistory[0].status).toBe('done');
  });

  it('promotes expected steps and finishes prior progress', () => {
    const {
      controller,
      scrollToLatest,
      state,
      updateLiveBuildStatus,
    } = setup();
    controller.handleStatus(event({ phase: 'preparing' }));
    controller.handleStatus(event({ phase: 'linking_deps' }));

    expect(state.buildHistory[0]).toMatchObject({
      status: 'running',
      steps: [
        { label: 'Preparing workspace', status: 'done' },
        { label: 'Loading Lean dependencies', status: 'running' },
        { label: 'Building Lean environment', status: 'pending' },
      ],
    });
    expect(updateLiveBuildStatus).toHaveBeenNthCalledWith(1, 'running');
    expect(updateLiveBuildStatus).toHaveBeenNthCalledWith(2, 'running');
    expect(scrollToLatest).toHaveBeenCalledTimes(2);
  });

  it('marks completed progress as failed on a terminal failure', () => {
    const { controller, state, updateLiveBuildStatus } = setup();
    controller.handleStatus(event({ phase: 'building' }));
    controller.handleStatus(event({ phase: 'failed' }));

    expect(state.buildHistory[0]).toMatchObject({
      status: 'failed',
      steps: [{ label: 'Building Lean environment', status: 'done' }],
    });
    expect(updateLiveBuildStatus).toHaveBeenLastCalledWith('failed');
  });

  it('clears buffered setup progress when the build is already current', () => {
    const { controller, state, updateLiveBuildStatus } = setup();
    controller.handleStatus(event({ phase: 'fetching' }));
    controller.handleStatus(event({ phase: 'up_to_date' }));
    controller.handleStatus(event({ phase: 'building' }));

    expect(state.buildHistory[0].steps).toEqual([
      { label: 'Building Lean environment', status: 'running' },
    ]);
    expect(updateLiveBuildStatus).toHaveBeenNthCalledWith(1, 'done');
    expect(updateLiveBuildStatus).toHaveBeenNthCalledWith(2, 'running');
  });
});
