import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatState } from '@/features/chat/state/types';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  stop: vi.fn(),
  respondPermission: vi.fn(),
  loadSubagentHistory: vi.fn(),
  handleScroll: vi.fn(),
  releaseTurnScroll: vi.fn(),
  scrollDownOnePane: vi.fn(),
  createTurnScrollCallback: vi.fn(),
  transcriptScrollOptions: null as { isBusy: () => boolean } | null,
  state: null as unknown,
}));

vi.mock('@/features/chat/state', () => ({ useChat: () => ({
  state: mocks.state,
  send: mocks.send,
  stop: mocks.stop,
  respondPermission: mocks.respondPermission,
  loadSubagentHistory: mocks.loadSubagentHistory,
}) }));
vi.mock('@/hooks/use-panel-resize', () => ({ usePanelResize: () => ({ panelWidth: 420, startResize: vi.fn() }) }));
vi.mock('@/features/chat/hooks/transcript-scroll', () => ({
  useTranscriptScroll: (options: { isBusy: () => boolean }) => {
    mocks.transcriptScrollOptions = options;
    return {
      scrollRef: { current: null }, transcriptRef: { current: null }, showMoreBelow: false,
      handleScroll: mocks.handleScroll,
      releaseTurnScroll: mocks.releaseTurnScroll,
      scrollDownOnePane: mocks.scrollDownOnePane,
      createTurnScrollCallback: mocks.createTurnScrollCallback,
    };
  },
}));

import ChatPanel from '@/features/chat/components/panel/ChatPanel';

function chatState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    messages: [], suggestion: null, activities: [], subagents: [], buildHistory: [], autonomousRunActive: false, sending: false,
    conversationId: null, currentJobId: null, sessionId: null, status: null, connected: false,
    viewingConversationId: null, historySession: null, historyTools: [], permissions: [], focusRequestToken: 0,
    liveSession: { isActiveSession: false, canSend: true, canCancel: false, buildStatus: 'not_started', displayStatus: null, turnActive: false, activeProverBatchId: null, activeProverBatchTotal: 0, activeProverBatchCompleted: 0, activeWorkGroupCount: 0 },
    ...overrides,
  };
}

function renderPanel(props: React.ComponentProps<typeof ChatPanel> = {}) {
  return render(<MemoryRouter><ChatPanel {...props} /></MemoryRouter>);
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(document, 'createRange').mockImplementation(() => ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ bottom: 0 }) }) as unknown as Range);
  mocks.state = chatState();
  mocks.send.mockReset(); mocks.stop.mockReset();
  mocks.respondPermission.mockReset();
  mocks.respondPermission.mockResolvedValue(undefined);
  mocks.loadSubagentHistory.mockReset();
  mocks.handleScroll.mockReset();
  mocks.releaseTurnScroll.mockReset();
  mocks.scrollDownOnePane.mockReset();
  mocks.createTurnScrollCallback.mockReset();
  mocks.transcriptScrollOptions = null;
  mocks.send.mockResolvedValue(true);
  mocks.stop.mockResolvedValue(undefined);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('ChatPanel', () => {
  it.each(['sending', 'turn', 'batch', 'workgroup', 'streaming'] as const)('hides the current reply copy button during %s and reveals it when finished', (busy) => {
    const finished = chatState({ messages: [
      { role: 'user', text: 'Review the project' },
      { role: 'agent', text: 'I will inspect the files.' },
    ] });
    mocks.state = {
      ...finished,
      sending: busy === 'sending',
      messages: busy === 'streaming' ? [finished.messages[0], { ...finished.messages[1], streaming: true }] : finished.messages,
      liveSession: {
        ...finished.liveSession,
        turnActive: busy === 'turn',
        activeProverBatchId: busy === 'batch' ? 'batch-1' : null,
        activeWorkGroupCount: busy === 'workgroup' ? 1 : 0,
      },
    };
    const { container, rerender } = renderPanel();
    expect(container.querySelector('.agent-message-actions')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Copy message' })).toHaveLength(1);
    mocks.state = finished;
    rerender(<MemoryRouter><ChatPanel /></MemoryRouter>);
    expect(container.querySelector('.agent-message-actions')).not.toBeNull();
  });

  it('keeps earlier completed replies copyable while the newest turn is active', () => {
    mocks.state = chatState({
      messages: [
        { role: 'user', text: 'First question' }, { role: 'agent', text: 'First answer' },
        { role: 'user', text: 'Next question' }, { role: 'agent', text: 'Working on it' },
      ],
      liveSession: { ...chatState().liveSession, turnActive: true },
    });
    const { container } = renderPanel();
    expect(container.querySelectorAll('.agent-message-actions')).toHaveLength(1);
  });

  it('renders empty state and sends its suggestion on Enter', () => {
    renderPanel();
    expect(screen.getByText('What should we do next?')).toBeInTheDocument();
    expect(screen.getByText('Tell me what can you do?')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(mocks.send).toHaveBeenCalledWith('Tell me what can you do?', expect.any(Function), []);
  });

  it('prefers typed input over a store suggestion', () => {
    mocks.state = chatState({ suggestion: '  Review the proof  ' });
    renderPanel();
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '  custom task  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mocks.send).toHaveBeenCalledWith('  custom task  ', expect.any(Function), []);
  });

  it('releases transcript following as soon as the user edits the composer', () => {
    mocks.state = chatState({
      messages: [
        { role: 'user', text: 'Question' },
        { role: 'agent', text: 'A long answer the user is reading' },
      ],
    });
    renderPanel();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'A multi-line\nfollow-up' },
    });

    expect(mocks.releaseTurnScroll).toHaveBeenCalled();
  });

  it('starts scroll following for an idle follow-up turn', () => {
    mocks.state = chatState({
      messages: [
        { role: 'user', text: 'Question' },
        { role: 'agent', text: 'Answer' },
      ],
      sessionId: 'session-1',
      status: 'running',
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        canSend: true,
      },
    });
    renderPanel();
    const composer = screen.getByRole('textbox');
    fireEvent.change(composer, { target: { value: 'Next question' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(mocks.send).toHaveBeenCalledWith(
      'Next question',
      mocks.createTurnScrollCallback,
      [],
    );
  });

  it('treats an in-flight idle request as a new turn, not steering', () => {
    mocks.state = chatState({
      sending: true,
      messages: [{ role: 'user', text: 'First follow-up' }],
      sessionId: 'session-1',
      status: 'running',
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        canSend: true,
        turnActive: false,
      },
    });
    renderPanel();
    const composer = screen.getByRole('textbox');
    fireEvent.change(composer, { target: { value: 'Second follow-up' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(mocks.send).toHaveBeenCalledWith(
      'Second follow-up',
      mocks.createTurnScrollCallback,
      [],
    );
  });

  it('keeps transcript following busy while delegated work is active', () => {
    mocks.state = chatState({
      sending: false,
      liveSession: {
        ...chatState().liveSession,
        activeWorkGroupCount: 1,
      },
    });
    renderPanel();

    expect(mocks.transcriptScrollOptions?.isBusy()).toBe(true);
  });

  it('restores the draft when a queued send is rejected', async () => {
    mocks.send.mockResolvedValue(false);
    renderPanel();
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Keep this steering note' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(textarea).toHaveValue('Keep this steering note');
    });
  });

  it('renders readonly notice and does not expose a composer', () => {
    renderPanel({ blueprintReadonly: true, chatReadonlyMessage: 'Locked project' });
    expect(screen.getByText('Locked project')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders another user’s shared history without exposing a composer', () => {
    mocks.state = chatState({
      messages: [
        { role: 'user', text: 'Shared question' },
        { role: 'agent', text: 'Shared answer' },
      ],
      historySession: {
        can_resume: false,
      } as NonNullable<ChatState['historySession']>,
    });
    renderPanel();
    expect(screen.getByText('Shared question')).toBeInTheDocument();
    expect(screen.getByText('Shared answer')).toBeInTheDocument();
    expect(screen.getByText('Shared chat is read-only.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders transcript markdown and agent errors', () => {
    mocks.state = chatState({ messages: [
      { role: 'user', text: 'Hello' }, { role: 'agent', text: '**Answer**' },
      { role: 'user', text: 'Again' }, { role: 'agent', text: 'Backend failed', isError: true },
    ] });
    renderPanel();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Answer').tagName).toBe('STRONG');
    expect(screen.getByRole('alert')).toHaveTextContent('Backend failed');
    expect(screen.getByText("Tell me what's next...")).toBeInTheDocument();
  });

  it('forwards workspace file navigation to transcript tool calls', () => {
    const onOpenFile = vi.fn();
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Inspect it' }, { role: 'agent', text: 'Done' }],
      activities: [{
        tool: 'Read',
        summary: 'Main.lean',
        rawInput: { file_path: '/repo/lean/Main.lean', offset: 12 },
        anchorTurnId: 'turn-0',
        anchorAfterMessageCount: 1,
      }],
    });
    renderPanel({
      availableFilePaths: ['lean/Main.lean'],
      onOpenFile,
    });

    fireEvent.click(screen.getByRole('button', {
      name: 'Open lean/Main.lean at line 12',
    }));
    expect(onOpenFile).toHaveBeenCalledWith('lean/Main.lean', 12);
  });

  it('sends draft attachments and opens persisted attachment sources', () => {
    const attachment = {
      attachment_kind: 'backend_source' as const,
      source_id: 'source-1', display_name: 'paper.tex',
      selection: { kind: 'page_range', start_page: 2, end_page: 4 },
    };
    mocks.state = chatState({ messages: [{ role: 'user', text: 'Use this', contextAttachments: [attachment] }] });
    const onDraftAttachmentsChange = vi.fn();
    const onOpenContextAttachment = vi.fn();
    renderPanel({
      draftAttachments: [attachment],
      onDraftAttachmentsChange,
      onOpenContextAttachment,
    });
    const persistedChip = screen.getByRole('button', { name: /^paper\.tex/i });
    expect(screen.getByText('Use this').closest('.user-message')?.parentElement).toHaveClass(
      'w-full',
      'min-w-0',
    );
    expect(persistedChip.parentElement).toHaveClass(
      'w-full',
      'min-w-0',
      'flex-col',
      'items-end',
    );
    expect(persistedChip).toHaveClass('max-w-[70%]');
    expect(persistedChip.querySelector('svg')).toBeInTheDocument();
    expect(persistedChip).toHaveTextContent('pages 2-4');
    fireEvent.click(persistedChip);
    expect(onOpenContextAttachment).toHaveBeenCalledWith(attachment);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(mocks.send).toHaveBeenCalledWith(expect.any(String), expect.any(Function), [attachment]);
    expect(onDraftAttachmentsChange).toHaveBeenCalledWith([]);
  });

  it('renders repository-file history chips as non-interactive', () => {
    const attachment = {
      attachment_kind: 'repo_file' as const,
      repo_path: 'src/Main.lean',
      display_name: 'src/Main.lean',
      selection: { kind: 'entire_file' as const },
    };
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Use this', contextAttachments: [attachment] }],
    });
    const onOpenContextAttachment = vi.fn();
    renderPanel({ onOpenContextAttachment });

    expect(screen.queryByRole('button', { name: /src\/Main\.lean/ })).not.toBeInTheDocument();
    expect(screen.getByText('src/Main.lean')).toHaveClass('font-medium');
    expect(onOpenContextAttachment).not.toHaveBeenCalled();
  });

  function runningAutonomousState() {
    return chatState({
      messages: [{ role: 'user', text: 'Go' }], sending: true,
      sessionId: 'session-1', status: 'running', autonomousRunActive: true,
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        canSend: false,
        canCancel: true,
        turnActive: true,
      },
    });
  }

  it('gives a running session a plain composer and still stops it', async () => {
    // A live run used to restate itself in the composer: a "Running
    // autonomously" line and a traced accent border. Every session runs
    // autonomously now, so the treatment marked the only mode there is. What
    // has to survive its removal is the steering composer itself -- the run is
    // still live, so the control ends the session rather than sending a turn.
    mocks.state = runningAutonomousState();
    const { container } = renderPanel();
    expect(screen.queryByText('Running autonomously')).not.toBeInTheDocument();
    const textbox = screen.getByRole('textbox');
    expect(textbox.closest('.chat-input-wrap')).toBeInTheDocument();
    expect(textbox.closest('.chat-input-wrap-autonomous')).toBeNull();
    expect(container.querySelector('.auto-running-border')).toBeNull();
    expect(screen.queryByRole('button', { name: /Work mode/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End this session' }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
  });

  it('allows steering while autonomous work is running', () => {
    // ADR 044: the composer stays mounted so a drifting run can be corrected
    // without stopping it.
    mocks.state = runningAutonomousState();
    renderPanel();
    const composer = screen.getByRole('textbox');
    expect(screen.getByRole('button', { name: 'End this session' }))
      .toBeInTheDocument();
    fireEvent.change(composer, { target: { value: 'stay in Section 9' } });
    expect(screen.queryByRole('button', { name: 'End this session' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' }))
      .toBeInTheDocument();
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(mocks.send).toHaveBeenCalledWith(
      'stay in Section 9',
      mocks.createTurnScrollCallback,
      [],
    );
  });

  it('renders an undelivered message after the transcript without an interrupt control', () => {
    mocks.state = chatState({
      messages: [{
        role: 'user',
        text: 'stay in Section 9',
        messageId: 'message-1',
        deliveryState: 'queued',
        contextAttachments: [{
          attachment_kind: 'backend_source',
          source_id: 'source-1',
          display_name: 'paper.tex',
          selection: { kind: 'entire_file' },
        }],
      }],
      sessionId: 'session-1',
      status: 'running',
      autonomousRunActive: true,
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        canCancel: true,
        turnActive: true,
      },
    });
    renderPanel();

    expect(screen.getByText('stay in Section 9').closest('.user-bubble')).toHaveClass(
      'pending-message-bubble',
    );
    expect(
      screen.queryByText('Will be sent when the current step finishes'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('paper.tex')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send now/ }))
      .not.toBeInTheDocument();
  });

  it('keeps an optimistic queued message visible before its id arrives', () => {
    mocks.state = chatState({
      messages: [{
        role: 'user',
        text: 'stay in Section 9',
        deliveryState: 'queued',
      }],
      sessionId: 'session-1',
      status: 'running',
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        turnActive: true,
      },
    });
    renderPanel();

    expect(screen.getByText('stay in Section 9')).toBeInTheDocument();
    expect(
      screen.queryByText('Will be sent when the current step finishes'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('stay in Section 9').closest('.user-bubble')).toHaveClass(
      'pending-message-bubble',
    );
    expect(screen.queryByRole('button', {
      name: 'Send now, interrupting the current step',
    })).not.toBeInTheDocument();
  });

  it('keeps an undelivered message below the thinking it arrived during', () => {
    // The bug this replaces: a user message opened a transcript turn the
    // moment it was accepted, splitting the running turn and shifting the
    // ordinal that activity anchors are keyed on — so the correction rendered
    // above the very thinking it was sent during (ADR 044).
    mocks.state = chatState({
      messages: [
        { role: 'user', text: 'formalize Section 9' },
        { role: 'agent', text: 'Reading the blueprint now', streaming: true },
        {
          role: 'user',
          text: 'stay in Section 9',
          messageId: 'message-1',
          deliveryState: 'queued',
        },
      ],
      sessionId: 'session-1',
      status: 'running',
      liveSession: {
        ...chatState().liveSession, isActiveSession: true, turnActive: true,
      },
    });
    renderPanel();

    const thinking = screen.getByText('Reading the blueprint now');
    const pending = screen.getByText('stay in Section 9');
    expect(
      thinking.compareDocumentPosition(pending)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // And exactly once: it lives in the pending run, not also spliced into
    // the transcript above.
    expect(screen.getAllByText('stay in Section 9')).toHaveLength(1);
  });

  it('keeps a delegated-work message pending without an interrupt control', () => {
    mocks.state = chatState({
      messages: [{
        role: 'user',
        text: 'golf AffineMap instead',
        messageId: 'message-1',
        deliveryState: 'queued',
      }],
      sessionId: 'session-1',
      status: 'running',
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        activeWorkGroupCount: 1,
      },
    });
    renderPanel();

    expect(screen.getByText('golf AffineMap instead').closest('.user-bubble')).toHaveClass(
      'pending-message-bubble',
    );
    expect(
      screen.queryByText('Will be sent once the delegated work finishes'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send now/ }))
      .not.toBeInTheDocument();
  });

  it('waits for a prover batch without offering an unsupported interrupt', () => {
    mocks.state = chatState({
      messages: [{
        role: 'user',
        text: 'Try the alternate lemma',
        messageId: 'message-1',
        deliveryState: 'queued',
      }],
      sessionId: 'session-1',
      status: 'running',
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        activeProverBatchId: 'batch-1',
      },
    });
    renderPanel();

    expect(screen.getByText('Try the alternate lemma').closest('.user-bubble')).toHaveClass(
      'pending-message-bubble',
    );
    expect(
      screen.queryByText('Will be sent once the prover batch finishes'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Send now/ }),
    ).not.toBeInTheDocument();
  });

  it('shows a steered message as already in the turn, with no override', () => {
    // Already inside the running turn, so offering the destructive override
    // would only throw away work the user has no reason to discard.
    mocks.state = chatState({
      messages: [{
        role: 'user',
        text: 'stay in Section 9',
        messageId: 'message-1',
        deliveryState: 'steered',
      }],
      sessionId: 'session-1',
      status: 'running',
      liveSession: {
        ...chatState().liveSession, isActiveSession: true, turnActive: true,
      },
      activities: [{
        tool: 'Read',
        summary: 'Main.lean',
        anchorTurnId: 'turn-0',
        anchorAfterMessageCount: 0,
      }],
    });
    renderPanel();

    expect(screen.getByText('stay in Section 9')).toBeInTheDocument();
    expect(screen.getByText('Main.lean')).toBeInTheDocument();
    expect(
      screen.queryByText('Will be sent when the current step finishes'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Send now, interrupting the current step',
      }),
    ).not.toBeInTheDocument();
  });

  it('does not pin a message the agent has already taken', () => {
    mocks.state = chatState({
      messages: [{
        role: 'user',
        text: 'stay in Section 9',
        messageId: 'message-1',
        deliveryState: 'delivered',
      }],
      sessionId: 'session-1',
      status: 'running',
      liveSession: { ...chatState().liveSession, isActiveSession: true },
    });
    renderPanel();

    expect(
      screen.queryByRole('button', { name: 'Deliver now' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Waiting for the current step to finish'),
    ).not.toBeInTheDocument();
  });

  it('labels a superseded message instead of treating it as an agent turn', () => {
    mocks.state = chatState({
      messages: [{
        role: 'user',
        text: 'use the abandoned approach',
        messageId: 'message-1',
        deliveryState: 'superseded',
      }],
    });
    const { container } = renderPanel();

    expect(screen.getByText('use the abandoned approach')).toBeInTheDocument();
    expect(screen.getByText('Not delivered to the agent')).toBeInTheDocument();
    expect(container.querySelector('[data-turn-id]')).toBeInTheDocument();
  });

  it('renders a Stop-retained message as an ordinary user message', () => {
    mocks.state = chatState({
      messages: [{
        role: 'user',
        text: 'Keep this for my next message',
        messageId: 'message-1',
        deliveryState: 'retained',
      }],
    });
    const { container } = renderPanel();

    expect(screen.getByText('Keep this for my next message')).toBeInTheDocument();
    expect(screen.queryByText('Not delivered to the agent')).not.toBeInTheDocument();
    expect(container.querySelector('.pending-message-bubble')).not.toBeInTheDocument();
  });

  it('keeps a superseded message before later conversation turns', () => {
    mocks.state = chatState({
      messages: [
        { role: 'user', text: 'Start here' },
        { role: 'agent', text: 'First answer' },
        {
          role: 'user',
          text: 'Old queued message',
          messageId: 'message-1',
          deliveryState: 'superseded',
        },
        { role: 'user', text: 'New session message' },
        { role: 'agent', text: 'New answer' },
      ],
    });
    renderPanel();

    const superseded = screen.getByText('Old queued message');
    const later = screen.getByText('New session message');
    expect(
      superseded.compareDocumentPosition(later)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('Not delivered to the agent')).toBeInTheDocument();
  });

  it('treats a stale queued message in a finished session as superseded', () => {
    mocks.state = chatState({
      messages: [{
        role: 'user',
        text: 'This session stopped before delivery',
        messageId: 'message-1',
        deliveryState: 'queued',
      }],
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: false,
      },
    });
    renderPanel();

    expect(screen.getByText('Not delivered to the agent')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Send now/ }),
    ).not.toBeInTheDocument();
  });

  it('latches Stop without rendering a status row above the composer', async () => {
    let releaseStop = () => {};
    mocks.stop.mockImplementation(() => new Promise<void>((resolve) => {
      releaseStop = resolve;
    }));
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Delegate the sections' }],
      sessionId: 'session-1',
      status: 'running',
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        canCancel: true,
        activeWorkGroupCount: 2,
        displayStatus: 'Delegated work is running (2/5).',
      },
    });
    renderPanel();

    expect(screen.queryByText('Delegated work is running (2/5).')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'End this session' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'End this session' })).toBeDisabled();
    });
    // A store update mid-cancel must not clobber the acknowledgement, and a
    // second click must not fire another cancel.
    expect(screen.getByRole('button', { name: 'End this session' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'End this session' }));
    expect(mocks.stop).toHaveBeenCalledOnce();

    await act(async () => releaseStop());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'End this session' })).toBeEnabled();
    });
  });

  it('blocks Send while Stop is pending with a draft', async () => {
    let releaseStop = () => {};
    mocks.stop.mockImplementation(() => new Promise<void>((resolve) => {
      releaseStop = resolve;
    }));
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Keep working' }],
      sessionId: 'session-1',
      status: 'running',
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        canSend: false,
        canCancel: true,
        turnActive: true,
      },
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'End this session' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'End this session' })).toBeDisabled();
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Next note' } });
    expect(screen.queryByRole('button', { name: 'End this session' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(mocks.send).not.toHaveBeenCalled();
    await act(async () => releaseStop());
  });

  it('keeps autonomous controls busy while delegated work runs between turns', async () => {
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Delegate the sections' }],
      sessionId: 'session-1',
      status: 'running',
      autonomousRunActive: true,
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        canSend: false,
        canCancel: true,
        activeWorkGroupCount: 1,
      },
    });

    renderPanel();

    // Delegated work counts as busy, so the empty composer still offers the
    // session control rather than a disabled Send.
    expect(screen.getByRole('button', { name: 'End this session' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End this session' }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
  });

  it('offers Stop for delegated work in interactive mode', async () => {
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Delegate a check' }],
      sessionId: 'session-1',
      status: 'running',
      autonomousRunActive: true,
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        canSend: false,
        canCancel: true,
        activeWorkGroupCount: 1,
      },
    });

    renderPanel();

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End this session' }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
  });

  it('does not render backend status text above the interactive composer', () => {
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Delegate a check' }],
      sessionId: 'session-1',
      status: 'running',
      liveSession: {
        ...chatState().liveSession,
        isActiveSession: true,
        canCancel: true,
        activeWorkGroupCount: 1,
        displayStatus: 'Stopping delegated work…',
      },
    });

    renderPanel();

    expect(screen.queryByText('Stopping delegated work…')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the composer for a preselected next effort level', () => {
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Go' }], sending: true, autonomousRunActive: true,
    });
    renderPanel();
    expect(screen.queryByText('Agent is working.')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End this session' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
  });

  it('expands and closes a subagent card from the transcript', () => {
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Go' }],
      subagents: [{ parentToolUseId: 'agent-1', anchorTurnId: 'turn-0', anchorAfterMessageCount: 0, description: 'Explore files', model: null, text: '', toolCalls: [], status: 'running', order: 1 }],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Explore files/i }));
    expect(mocks.loadSubagentHistory).toHaveBeenCalledWith('agent-1');
    expect(screen.getByText('Waiting for tool calls...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close subagent view' }));
    expect(screen.queryByText('Waiting for tool calls...')).not.toBeInTheDocument();
  });

  it('dismisses the expanded timeline when its file reference opens', () => {
    const onOpenFile = vi.fn();
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Go' }],
      subagents: [{
        parentToolUseId: 'agent-1',
        anchorTurnId: 'turn-0',
        anchorAfterMessageCount: 0,
        description: 'Explore files',
        model: null,
        text: '',
        toolCalls: [{
          tool: 'Read',
          summary: 'Main.lean',
          rawInput: { file_path: '/repo/lean/Main.lean', offset: 9 },
          order: 1,
        }],
        status: 'running',
        order: 1,
      }],
    });
    renderPanel({
      availableFilePaths: ['lean/Main.lean'],
      onOpenFile,
    });

    fireEvent.click(screen.getByRole('button', { name: /Explore files/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {
      name: 'Open lean/Main.lean at line 9',
    }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onOpenFile).toHaveBeenCalledWith('lean/Main.lean', 9);
  });

  it('renders one node per specialist and opens its whole exchange', () => {
    const authoringRun = (
      id: string,
      description: string,
      order: number,
      batchId: string,
    ) => ({
      parentToolUseId: id,
      anchorTurnId: 'turn-0',
      anchorAfterMessageCount: 0,
      description,
      model: null,
      text: '',
      toolCalls: [{ tool: 'Read', summary: `${id}.lean`, order: order + 0.5 }],
      status: 'done' as const,
      synthetic: 'authoring',
      batchId,
      launcherTool: 'authoring-tools' as const,
      order,
    });
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Formalize the section' }],
      activities: [{
        tool: 'authoring-tools',
        summary: 'formalize',
        hidden: true,
        anchorTurnId: 'turn-0',
        anchorAfterMessageCount: 0,
        order: 1,
        rawInput: { labels: ['thm:main'] },
      }],
      subagents: [
        authoringRun('w1', 'Formalizer', 2, 'formalize-a'),
        authoringRun('r1', 'Reviewer', 3, 'formalize-a'),
        authoringRun('w2', 'Formalizer', 4, 'formalize-a'),
        authoringRun('r2', 'Reviewer', 5, 'formalize-a'),
      ],
    });
    const { container } = renderPanel();

    // Six per-pass cards before ADR 051; one standing specialist after it.
    const nodes = container.querySelectorAll(
      '.chat-messages .subagent-card.is-specialist',
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toHaveTextContent('Formalizer');
    expect(container.querySelector('.chat-messages .subagent-group')).toBeNull();

    // Opening it hydrates every run in the exchange and shows the newest turn.
    fireEvent.click(nodes[0] as HTMLElement);
    expect(mocks.loadSubagentHistory.mock.calls.map((call) => call[0]))
      .toEqual(['w1', 'r1', 'w2', 'r2']);
    expect(container.querySelector('.subagent-expanded-title'))
      .toHaveTextContent('Formalizer');
    expect(container.querySelector('[aria-label="Iteration: Reviewer 2"]'))
      .not.toBeNull();
    const timeline = container.querySelector('.subagent-expanded-timeline');
    expect(timeline?.textContent).toContain('r2.lean');
    expect(timeline?.textContent).not.toContain('w1.lean');
  });

  it('hydrates an explore summary without opening its timeline', () => {
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Survey the repository' }],
      subagents: [{
        parentToolUseId: 'explore-1',
        anchorTurnId: 'turn-0',
        anchorAfterMessageCount: 0,
        description: 'Explore files',
        model: null,
        text: '',
        toolCalls: [],
        status: 'done',
        synthetic: 'explore',
        historyLoaded: false,
        order: 1,
      }],
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Explore files/i }));

    expect(mocks.loadSubagentHistory).toHaveBeenCalledWith('explore-1');
    expect(
      screen.queryByRole('button', { name: 'Close subagent view' }),
    ).not.toBeInTheDocument();
  });

  it('returns to the parent subagent when a nested subagent closes', () => {
    const scrollHeight = vi.spyOn(
      HTMLElement.prototype,
      'scrollHeight',
      'get',
    ).mockReturnValue(500);
    const clientHeight = vi.spyOn(
      HTMLElement.prototype,
      'clientHeight',
      'get',
    ).mockReturnValue(100);
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Delegate the proof' }],
      subagents: [
        {
          parentToolUseId: 'orchestrator',
          anchorTurnId: 'turn-0',
          anchorAfterMessageCount: 0,
          description: 'Section orchestrator',
          model: null,
          text: '',
          toolCalls: [{
            tool: 'authoring-tools',
            summary: 'formalize',
            hidden: false,
            order: 1,
          }],
          status: 'running',
          order: 1,
        },
        {
          parentToolUseId: 'formalizer',
          parentSubagentId: 'orchestrator',
          anchorTurnId: 'turn-0',
          anchorAfterMessageCount: 0,
          description: 'Formalizer pass 1',
          model: null,
          text: '',
          toolCalls: [],
          status: 'running',
          order: 2,
          synthetic: 'regional-specialist',
          batchId: 'formalize-batch-1',
          launcherTool: 'authoring-tools',
        },
      ],
    });
    const { container } = renderPanel();

    // The parent preview stays compact even though the live authoring workflow
    // has a structured regional-specialist child.
    expect(screen.queryByText('Formalizer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Section orchestrator/i }));
    const parentTimeline = container.querySelector(
      '.subagent-expanded-timeline',
    ) as HTMLElement;
    parentTimeline.scrollTop = 75;
    fireEvent.scroll(parentTimeline);
    // The region's authoring child is its standing specialist (ADR 051), so
    // the nested node is labelled for the role, not for the pass.
    const nestedCard = container.querySelector(
      '.subagent-expanded .subagent-card',
    );
    expect(nestedCard).toHaveTextContent('Formalizer');
    expect(nestedCard).not.toHaveTextContent('pass 1');
    fireEvent.click(nestedCard as HTMLElement);
    expect(container.querySelector('.subagent-expanded-title')).toHaveTextContent(
      'Formalizer',
    );

    const childClose = screen.getByRole('button', { name: 'Close subagent view' });
    childClose.focus();
    fireEvent.click(childClose);
    expect(container.querySelector('.subagent-expanded-title')).toHaveTextContent(
      'Section orchestrator',
    );
    expect(
      (container.querySelector('.subagent-expanded-timeline') as HTMLElement)
        .scrollTop,
    ).toBe(75);
    // Remounting the overlay on drill-down/return must not drop focus to
    // <body>: the dialog itself takes it so the keyboard stays inside.
    expect(container.querySelector('.subagent-expanded')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Close subagent view' }));
    expect(container.querySelector('.subagent-expanded')).not.toBeInTheDocument();
    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  });

  it('drops remembered subagent scroll offsets when the conversation changes', () => {
    const subagent = {
      parentToolUseId: 'agent-1', anchorTurnId: 'turn-0', anchorAfterMessageCount: 0,
      description: 'Explore files', model: null, text: '', status: 'running' as const,
      toolCalls: [{ tool: 'Read', summary: 'A.lean', order: 1 }], order: 1,
    };
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Go' }],
      conversationId: 'conversation-1',
      subagents: [subagent],
    });
    const { container, rerender } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Explore files/i }));
    const timeline = container.querySelector('.subagent-expanded-timeline') as HTMLElement;
    timeline.scrollTop = 64;
    fireEvent.scroll(timeline);

    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Different chat' }],
      conversationId: 'conversation-2',
      subagents: [subagent],
    });
    rerender(<MemoryRouter><ChatPanel /></MemoryRouter>);
    // The overlay closes and the offset is forgotten, rather than being
    // replayed onto an unrelated conversation's subagent of the same id.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Explore files/i }));
    expect(
      (container.querySelector('.subagent-expanded-timeline') as HTMLElement).scrollTop,
    ).toBe(0);
  });

  it('presents the expanded subagent as a modal dialog over an inert transcript', () => {
    mocks.state = chatState({
      messages: [{ role: 'user', text: 'Go' }],
      subagents: [{
        parentToolUseId: 'agent-1', anchorTurnId: 'turn-0', anchorAfterMessageCount: 0,
        description: 'Explore files', model: null, text: '', toolCalls: [],
        status: 'running', order: 1,
      }],
    });
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Explore files/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Subagent: Explore files');
    expect(dialog).toHaveFocus();
    // Everything painted underneath is removed from the tab order.
    expect(container.querySelector('.chat-messages')).toHaveAttribute('inert');
    expect(container.querySelector('.chat-input-area')).toHaveAttribute('inert');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.querySelector('.chat-messages')).not.toHaveAttribute('inert');
  });
  describe('permission prompts', () => {
    const PROMPT = {
      request_id: 'perm-1',
      tool: 'Bash',
      input: { command: 'lake build' },
      description: 'Run the Lean build',
      reason: 'Bash commands need approval',
      suggestions: [
        { label: 'Always allow lake build', payload: { rule: 'Bash(lake build:*)' } },
      ],
      tool_use_id: 'tool-1',
      assistant_turn_id: 'turn-0:assistant-0',
      anchorTurnId: 'turn-0',
      anchorAfterMessageCount: 0,
      order: 2,
    };

    function pausedState(overrides: Partial<ChatState> = {}): ChatState {
      return chatState({
        messages: [{ role: 'user', text: 'Build the project' }],
        sessionId: 'session-1',
        status: 'running',
        activities: [{
          tool: 'Bash', summary: 'lake build', toolUseId: 'tool-1',
          rawInput: { command: 'lake build' },
          anchorTurnId: 'turn-0', anchorAfterMessageCount: 0, order: 2,
        }],
        permissions: [PROMPT],
        liveSession: {
          ...chatState().liveSession,
          isActiveSession: true, canSend: false, canCancel: true, turnActive: true,
          displayStatus: 'Waiting for your approval.',
        },
        ...overrides,
      });
    }

    it('hides copy while approval is pending even if the live turn flag has cleared', () => {
      mocks.state = pausedState({
        messages: [{ role: 'user', text: 'Build' }, { role: 'agent', text: 'I will run the build.' }],
        liveSession: chatState().liveSession,
      });
      const { container } = renderPanel();
      expect(container.querySelector('.agent-message-actions')).toBeNull();
    });

    it('renders the card beside the paused tool row with allow, suggestion and deny', () => {
      mocks.state = pausedState();
      const { container } = renderPanel();

      const card = screen.getByRole('group', { name: 'Permission request: Bash' });
      expect(card).toHaveTextContent('Run this command?');
      expect(card).toHaveTextContent('Run the Lean build');
      expect(card).toHaveTextContent('Bash commands need approval');
      expect(card).toHaveTextContent('lake build');
      // The card follows the tool row inside the same agent row.
      const toolRow = container.querySelector('.chat-inline-toolcall');
      expect(toolRow).not.toBeNull();
      expect(toolRow?.nextElementSibling).toBe(card);
      // The composer stays: a paused turn can still be steered or stopped.
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'End this session' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Always allow lake build' }));
      expect(mocks.respondPermission).toHaveBeenCalledWith('perm-1', {
        behavior: 'allow',
        suggestion: { rule: 'Bash(lake build:*)' },
      });
      // One answer per prompt: the buttons latch after the first click.
      expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
      expect(mocks.respondPermission).toHaveBeenCalledOnce();
    });

    it('sends a plain allow and a deny', () => {
      mocks.state = pausedState();
      const first = renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
      expect(mocks.respondPermission).toHaveBeenLastCalledWith('perm-1', { behavior: 'allow' });
      first.unmount();

      mocks.state = pausedState();
      renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
      expect(mocks.respondPermission).toHaveBeenLastCalledWith('perm-1', { behavior: 'deny' });
    });

    it('shows a prompt with no tool row above the composer and hints in the placeholder', () => {
      mocks.state = pausedState({
        activities: [],
        permissions: [{ ...PROMPT, tool_use_id: null, anchorTurnId: null, anchorAfterMessageCount: 0 }],
      });
      const { container } = renderPanel();
      const card = screen.getByRole('group', { name: 'Permission request: Bash' });
      expect(container.querySelector('.chat-input-area')).toContainElement(card);
      expect(container.querySelector('.chat-input-area')).toHaveTextContent(
        'Approve or deny the pending action, or steer the agent...',
      );
    });
  });

  describe('desktop shell events', () => {
    it('focuses the composer on fuse:focus-composer', () => {
      mocks.state = chatState({ messages: [{ role: 'user', text: 'Hi' }] });
      renderPanel();
      const textarea = screen.getByRole('textbox');
      textarea.blur();
      expect(textarea).not.toHaveFocus();
      act(() => {
        window.dispatchEvent(new CustomEvent('fuse:focus-composer'));
      });
      expect(textarea).toHaveFocus();
    });

    it('stops a live turn on fuse:stop-turn and ignores it when idle', async () => {
      mocks.state = chatState({ messages: [{ role: 'user', text: 'Hi' }] });
      const idle = renderPanel();
      act(() => {
        window.dispatchEvent(new CustomEvent('fuse:stop-turn'));
      });
      expect(mocks.stop).not.toHaveBeenCalled();
      idle.unmount();

      mocks.state = chatState({
        messages: [{ role: 'user', text: 'Keep working' }],
        sessionId: 'session-1',
        status: 'running',
        liveSession: {
          ...chatState().liveSession,
          isActiveSession: true, canSend: false, canCancel: true, turnActive: true,
        },
      });
      renderPanel();
      act(() => {
        window.dispatchEvent(new CustomEvent('fuse:stop-turn'));
      });
      await waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
    });
  });
});
