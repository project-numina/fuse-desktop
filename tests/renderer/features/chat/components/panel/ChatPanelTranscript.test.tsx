import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ChatPanelTranscript from '@/features/chat/components/panel/ChatPanelTranscript';

function props() {
  return {
    activityTurnId: null,
    activities: [],
    availableFilePaths: [],
    bucketEntries: vi.fn(() => []),
    childSubagentsOfGroup: vi.fn(() => []),
    expanded: false,
    handleScroll: vi.fn(),
    latestTurnId: null,
    macros: {},
    onExpandSubagent: vi.fn(),
    onPermissionDecision: vi.fn(async () => {}),
    pendingUserMessages: [],
    permissionsPending: false,
    promptsForBucket: vi.fn(() => []),
    promptsForTurn: vi.fn(() => []),
    releaseTurnScroll: vi.fn(),
    renderedTurns: [],
    responseEndRef: createRef<HTMLDivElement>(),
    scrollDownOnePane: vi.fn(),
    scrollRef: createRef<HTMLDivElement>(),
    sessionBusy: false,
    sessionLive: false,
    showMoreBelow: true,
    subagentsForTurn: vi.fn(() => []),
    transcriptRef: createRef<HTMLDivElement>(),
    turnHasActivity: vi.fn(() => false),
  };
}

describe('ChatPanelTranscript', () => {
  it('keeps scroll controls and modal inertness at the transcript boundary', () => {
    const values = props();
    const { container } = render(
      <ChatPanelTranscript {...values} expanded />,
    );

    expect(container.querySelector('.chat-messages')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'More to read below' }));
    expect(values.scrollDownOnePane).toHaveBeenCalledOnce();
  });
});
