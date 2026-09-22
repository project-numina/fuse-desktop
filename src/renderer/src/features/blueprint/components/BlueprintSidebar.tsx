import { BlueprintIcon, GitIcon, WorkspaceIcon } from '@/components/icons/ProjectIcons';
import { cn } from '@/lib/utils';
import { sidebarItemClass as toolbarButtonClass } from '@/components/ui/sidebar-item';
import type { ReactNode } from 'react';
import { useSessionAttention } from '@/hooks/use-session-attention';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Left navigation chrome for the blueprint workspace.
 *
 * Switches the active mode and surfaces Source/OCR status and unread chats.
 */

/** Internal mode names the sidebar switches between. */
export type BlueprintMode =
  | 'home'
  | 'edit'
  | 'graph'
  | 'source'
  | 'view'
  | 'history'
  | 'git'
  | 'settings';

/** Resolved OCR status the Source dot reflects. */
export type SidebarOcrStatus = 'not_started' | 'scanning' | 'complete' | 'failed';

export interface BlueprintSidebarProps {
  owner?: string;
  repository?: string;
  blueprintId?: string;
  /** Currently active mode. */
  mode: BlueprintMode;
  /** Blueprint source type; the OCR dot only shows for `'pdf'`. */
  sourceType?: string;
  /** Merged (read-only) blueprints hide the New chat affordance. */
  readonly?: boolean;
  /** Public shares hide history/git/settings. */
  publicShare?: boolean;
  /** Resolved OCR status (page-owned). Defaults to `'not_started'`. */
  ocrStatus?: SidebarOcrStatus;
  /** Invoked when the user picks a different mode. */
  onModeChange: (mode: BlueprintMode) => void;
  /** Invoked when the user clicks New chat. */
  onNewChat?: () => void;
  footer?: ReactNode;
}

const ocrStatusLabels: Record<SidebarOcrStatus, string> = {
  scanning: 'Scanning…',
  complete: 'Done',
  failed: 'OCR failed',
  not_started: 'Not scanned',
};

const iconClass = 'h-4 w-4 shrink-0';

function BlueprintSidebar({
  owner,
  repository,
  blueprintId,
  mode,
  sourceType = '',
  readonly = false,
  publicShare = false,
  ocrStatus = 'not_started',
  onModeChange,
  onNewChat,
  footer,
}: BlueprintSidebarProps) {
  const unreadCount = useSessionAttention().filter((entry) => entry.unread && entry.owner === owner && entry.repository === repository && entry.blueprint === blueprintId).length;
  // The OCR dot is meaningful only while actively scanning or surfacing a
  // retryable failure, and only for PDF sources.
  const showOcrDot =
    sourceType === 'pdf' && (ocrStatus === 'scanning' || ocrStatus === 'failed');

  return (
    <aside className="flex w-36 shrink-0 flex-col gap-1 overflow-visible border-r border-border bg-card px-2 py-3">
      <button
        type="button"
        className={toolbarButtonClass(mode === 'home')}
        onClick={() => onModeChange('home')}
      >
        <WorkspaceIcon className={iconClass} />
        <span>Overview</span>
      </button>

      <button
        type="button"
        className={toolbarButtonClass(mode === 'edit')}
        onClick={() => onModeChange('edit')}
      >
        <BlueprintIcon className={iconClass} />
        <span>Blueprint</span>
      </button>

      <button
        type="button"
        className={toolbarButtonClass(mode === 'graph')}
        onClick={() => onModeChange('graph')}
      >
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9L9 19L15 5L20 17" />
          <circle cx="4" cy="9" r="2" fill="currentColor" />
          <circle cx="9" cy="19" r="2" fill="currentColor" />
          <circle cx="15" cy="5" r="2.5" fill="currentColor" />
          <circle cx="20" cy="17" r="2" fill="currentColor" />
        </svg>
        <span>Graph</span>
      </button>

      <button
        type="button"
        className={toolbarButtonClass(mode === 'view' || mode === 'source', 'relative')}
        onClick={() => onModeChange('view')}
      >
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span>Files</span>
        {showOcrDot && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="absolute right-3 top-1/2 inline-flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center outline-none"
                  role="img"
                  aria-label={`OCR status: ${ocrStatusLabels[ocrStatus]}`}
                />
              }
            >
              <span
                className={cn(
                  'h-[7px] w-[7px] rounded-full',
                  ocrStatus === 'scanning'
                    ? 'bg-primary'
                    : 'bg-destructive',
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="right">
              <span className="mb-0.5 block text-[0.7rem] font-semibold uppercase tracking-wide text-foreground">
                OCR scan
              </span>
              {ocrStatusLabels[ocrStatus]}
            </TooltipContent>
          </Tooltip>
        )}
      </button>

      {!publicShare && (
        <>
          <div className="mx-3 my-2 h-px bg-border" />

          {!readonly && (
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => onNewChat?.()}
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--numina-border-light)] text-muted-foreground">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="5" y1="1" x2="5" y2="9" />
                  <line x1="1" y1="5" x2="9" y2="5" />
                </svg>
              </span>
              <span>New chat</span>
            </button>
          )}

          <button
            type="button"
            className={toolbarButtonClass(mode === 'history')}
            onClick={() => onModeChange('history')}
          >
            <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>History</span>
            {unreadCount > 0 && <span aria-label={`${unreadCount} unread chats`} className="ml-auto shrink-0 text-xs font-normal tabular-nums text-muted-foreground">{unreadCount}</span>}
          </button>

          <div className="mx-3 my-2 h-px bg-border" />

          <button
            type="button"
            className={toolbarButtonClass(mode === 'git')}
            onClick={() => onModeChange('git')}
          >
            {/* Git logo (git-scm.com, CC-BY 3.0), rendered via currentColor so
                it follows the sidebar theming. */}
            <GitIcon className={iconClass} />
            <span>Changes</span>
          </button>

          <button
            type="button"
            className={toolbarButtonClass(mode === 'settings')}
            onClick={() => onModeChange('settings')}
          >
            <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>Settings</span>
          </button>
        </>
      )}
      {footer && <div>{footer}</div>}
    </aside>
  );
}

export default BlueprintSidebar;
