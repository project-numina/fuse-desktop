import type { KeyboardEvent, MouseEvent } from 'react';

import {
  conversationActivity,
  conversationStatus,
  conversationSummary,
} from '@/pages/chats/chat-helpers';
import type { RecentConversation } from '@/pages/chats/chat-types';
import type { ChatsPageModel } from '@/pages/chats/use-chats-page';

function DeleteIcon() {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function ConversationMetadata({ conversation }: { conversation: RecentConversation }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">
        {conversation.repository_name} / {conversation.blueprint_name}
      </span>
      <span className="inline-flex shrink-0 gap-2">
        <span aria-hidden="true">·</span>{conversationActivity(conversation)}
      </span>
    </div>
  );
}

function ConversationTitle({ conversation }: { conversation: RecentConversation }) {
  const status = conversationStatus(conversation.tier);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {conversationSummary(conversation)}
      </span>
      {status ? (
        <span className="flex-shrink-0 text-[0.72rem] text-primary">{status}</span>
      ) : null}
    </span>
  );
}

function activateOnKey(
  event: KeyboardEvent<HTMLDivElement>,
  conversation: RecentConversation,
  openConversation: ChatsPageModel['openConversation'],
) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  if (!(event.target instanceof HTMLElement && event.target.closest('button'))) {
    openConversation(conversation);
  }
}

function ConversationRow({
  conversation,
  model,
}: {
  conversation: RecentConversation;
  model: ChatsPageModel;
}) {
  const handleDelete = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void model.deleteConversation(conversation.id);
  };
  return (
    <div
      className="history-session-row group flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-3 py-3.5 text-left"
      role="button" tabIndex={0}
      onClick={() => model.openConversation(conversation)}
      onKeyDown={(event) => activateOnKey(event, conversation, model.openConversation)}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <ConversationTitle conversation={conversation} />
        <ConversationMetadata conversation={conversation} />
      </div>
      <button
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
        type="button" title="Delete chat" onClick={handleDelete}
      >
        <DeleteIcon />
      </button>
    </div>
  );
}

function EmptyState({ model }: { model: ChatsPageModel }) {
  if (model.error && model.conversations.length === 0) {
    return <p className="mt-2 text-sm text-destructive">{model.error}</p>;
  }
  if (model.loading) {
    return <p className="py-3 text-sm text-muted-foreground">Loading…</p>;
  }
  if (model.conversations.length === 0) {
    return (
      <p className="py-3 text-sm text-muted-foreground">
        No chats yet. New ones will appear here.
      </p>
    );
  }
  return null;
}

function ConversationsList({ model }: { model: ChatsPageModel }) {
  if (model.conversations.length === 0) return null;
  return (
    <div className="history-session-list flex flex-col gap-0.5">
      {model.conversations.map((conversation) => (
        <ConversationRow key={conversation.id} conversation={conversation} model={model} />
      ))}
    </div>
  );
}

function LoadMoreButton({ model }: { model: ChatsPageModel }) {
  if (!model.hasMore || model.conversations.length === 0) return null;
  return (
    <button
      className="mt-2 block w-full py-2.5 text-sm text-primary transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-60"
      type="button" disabled={model.loadingMore} onClick={() => void model.loadMore()}
    >
      {model.loadingMore ? 'Loading…' : 'Load more'}
    </button>
  );
}

export default function ChatsView({ model }: { model: ChatsPageModel }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-16 pt-10">
      <h2 className="mb-6 text-2xl font-bold text-foreground">Recent chats</h2>
      <EmptyState model={model} />
      {model.deleteError ? (
        <p className="mt-2 text-sm text-destructive">{model.deleteError}</p>
      ) : null}
      <ConversationsList model={model} />
      {model.error && model.conversations.length > 0 ? (
        <p className="mt-2 text-sm text-destructive">{model.error}</p>
      ) : null}
      <LoadMoreButton model={model} />
    </main>
  );
}
