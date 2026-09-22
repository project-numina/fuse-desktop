import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  const points = direction === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6';
  return (
    <svg
      className={direction === 'left' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points={points} />
    </svg>
  );
}

function CollapsedHandle({ onToggle }: { onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label="Show files panel"
      title="Show files panel"
      className="fixed right-0 top-1/2 z-20 flex h-14 w-[22px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-l-[28px] border border-r-0 border-[var(--numina-border)] bg-[var(--numina-card-bg)] p-0 text-[var(--text-muted)] shadow-[-2px_0_8px_rgb(0_0_0/0.08)] transition-[background,color,width] hover:w-[26px] hover:bg-[var(--numina-border-light)] hover:text-[var(--numina-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--numina-accent)]"
      onClick={onToggle}
    >
      <Chevron direction="left" />
    </button>
  );
}

function HideHandle({ rail, onToggle }: { rail: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label="Hide panel"
      title="Hide panel"
      className={cn(
        'absolute right-0 top-1/2 z-[3] flex h-10 w-3.5 translate-x-full -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-[20px] border border-l-0 border-[var(--numina-border)] bg-[var(--numina-card-bg)] p-0 text-[var(--text-muted)] shadow-[2px_0_6px_rgb(0_0_0/0.06)] transition-[background,color,width] hover:w-[18px] hover:bg-[var(--numina-border-light)] hover:text-[var(--numina-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--numina-accent)]',
        rail && 'hidden',
      )}
      onClick={onToggle}
    >
      <Chevron direction="right" />
    </button>
  );
}

type PanelTab = 'files' | 'infoview';

function TabBar({ activeTab, onChange }: {
  activeTab: PanelTab;
  onChange: (tab: PanelTab) => void;
}) {
  return (
    <div className="flex shrink-0 items-stretch border-b border-[var(--numina-border-light)]">
      {(['files', 'infoview'] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          className={cn(
            'flex flex-1 cursor-pointer items-center justify-center gap-[var(--space-2)] border-0 border-b-2 bg-none px-[var(--space-2)] py-[var(--space-3)] text-sm font-semibold transition-[color,border-color] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--numina-accent)]',
            activeTab === tab
              ? 'border-[var(--numina-accent)] text-[var(--text-primary)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]',
          )}
          onClick={() => onChange(tab)}
        >
          {tab === 'files' ? 'Files' : 'Infoview'}
        </button>
      ))}
    </div>
  );
}

interface ChangedFilesPanelViewProps {
  collapsed: boolean;
  rail: boolean;
  filesPane: ReactNode;
  infoview?: ReactNode;
  onToggleCollapsed: () => void;
}

export default function ChangedFilesPanelView({
  collapsed,
  rail,
  filesPane,
  infoview,
  onToggleCollapsed,
}: ChangedFilesPanelViewProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('files');
  if (collapsed) return <CollapsedHandle onToggle={onToggleCollapsed} />;
  const infoviewPane = infoview ?? (
    <div className="px-[var(--space-3)] py-[var(--space-6)] text-center text-sm text-[var(--text-muted)]">
      Select a Lean file to view proof goals and diagnostics.
    </div>
  );
  return (
    <div className={cn(
      'relative flex w-full flex-col',
      rail ? 'h-full min-h-0' : 'h-[min(55vh,540px)] min-h-[360px]',
    )}>
      <HideHandle rail={rail} onToggle={onToggleCollapsed} />
      <aside className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--numina-card-bg)]',
        rail
          ? 'rounded-none border-0 shadow-none'
          : 'rounded-[var(--radius-md)] border border-[var(--numina-border)] shadow-[var(--numina-shadow)]',
      )}>
        <TabBar activeTab={activeTab} onChange={setActiveTab} />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            activeTab !== 'files' && 'hidden',
          )}>
            {filesPane}
          </div>
          <div className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            activeTab !== 'infoview' && 'hidden',
          )}>
            {infoviewPane}
          </div>
        </div>
      </aside>
    </div>
  );
}
