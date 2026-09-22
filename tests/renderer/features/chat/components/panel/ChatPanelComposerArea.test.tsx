import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ChatComposerHandle } from '@/features/chat/components/composer/ChatComposer';
import ChatPanelComposerArea from '@/features/chat/components/panel/ChatPanelComposerArea';

function props() {
  return {
    addDraftAttachment: vi.fn(),
    blueprintId: 'blueprint',
    canSendMessage: true,
    composerHasContent: false,
    composerPlaceholder: 'Continue here',
    composerRef: createRef<ChatComposerHandle>(),
    draftAttachments: [],
    expanded: false,
    handleComposerChange: vi.fn(),
    handleSend: vi.fn(async () => {}),
    handleStop: vi.fn(async () => {}),
    hasMessages: true,
    input: '',
    onPermissionDecision: vi.fn(async () => {}),
    owner: 'owner',
    readonly: false,
    readonlyMessage: 'Read only',
    removeDraftAttachment: vi.fn(),
    repository: 'repository',
    sessionBusy: false,
    stopPending: false,
    suggestedMessage: 'Start here',
    unplacedPrompts: [],
  };
}

describe('ChatPanelComposerArea', () => {
  it('uses the follow-up placeholder when a transcript exists', () => {
    render(<ChatPanelComposerArea {...props()} />);

    expect(screen.getByRole('textbox', { name: 'Continue here' }))
      .toBeInTheDocument();
  });

  it('replaces an empty composer with the readonly notice', () => {
    render(
      <ChatPanelComposerArea
        {...props()}
        hasMessages={false}
        readonly
      />,
    );

    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
