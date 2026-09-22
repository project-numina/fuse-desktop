import { lazy, Suspense } from 'react';
import { LatexEditor } from '@/components/editor/LatexEditor';
import { cn } from '@/lib/utils';
import type { SourceModeController, SourceTextSelection } from './use-source-mode';

const PdfViewer = lazy(() => import('@/features/blueprint/components/PdfViewer'));

function SourceSwitcher({ controller }: { controller: SourceModeController }) {
  const { hasPdfPreview, hasTextArtifact, sourceType, subView, setSubView } = controller;
  if (!hasPdfPreview || !hasTextArtifact) return null;
  const buttonClass = (view: 'pdf' | 'latex') => cn(
    'cursor-pointer px-4 py-1 text-xs font-medium transition-colors',
    subView === view
      ? 'bg-primary text-[var(--text-on-accent)]'
      : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
  );
  return (
    <div className="absolute left-6 top-3 z-10 flex overflow-hidden rounded-full bg-card shadow-[0_2px_8px_rgb(0_0_0/12%)]">
      <button type="button" className={buttonClass('pdf')} onClick={() => setSubView('pdf')}>
        PDF
      </button>
      <button type="button" className={buttonClass('latex')} onClick={() => setSubView('latex')}>
        {sourceType === 'pdf' ? 'OCR' : 'Text'}
      </button>
    </div>
  );
}

function PdfSource({ controller }: { controller: SourceModeController }) {
  if (!controller.pdfUrl) {
    return (
      <div className="mx-auto flex min-h-[320px] max-w-[800px] items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground">
        <p className="m-0">PDF preview is unavailable.</p>
      </div>
    );
  }
  return (
    <Suspense fallback={(
      <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
        Loading PDF…
      </div>
    )}>
      <PdfViewer url={controller.pdfUrl} title={controller.sourceFileName} />
    </Suspense>
  );
}

function SourceMessage({ children }: { children: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-3 px-6 pb-6 pt-[var(--empty-state-anchor)] text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function EmptySource() {
  return (
    <div className="flex flex-1 flex-col items-center gap-3 px-6 pb-6 pt-[var(--empty-state-anchor)] text-center">
      <p className="m-0 text-lg font-semibold text-foreground">No source selected</p>
      <p className="m-0 max-w-[320px] text-sm leading-relaxed text-muted-foreground">
        Add a source or pick one from the panel on the right to preview it here.
      </p>
    </div>
  );
}

function selectionLabel(selection: SourceTextSelection): string {
  return selection.startLine === selection.endLine
    ? `line ${selection.startLine}`
    : `lines ${selection.startLine}-${selection.endLine}`;
}

function SelectionToolbar({ controller }: { controller: SourceModeController }) {
  const selection = controller.textSelection;
  if (!controller.canAttachSelection || !selection) return null;
  return (
    <div className="sticky top-3 z-10 mb-3 flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2 text-xs shadow-lg">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-semibold text-muted-foreground">
          {selectionLabel(selection)}
        </span>
        {selection.preview ? <span className="truncate text-foreground">{selection.preview}</span> : null}
      </div>
      <button
        type="button"
        className="shrink-0 rounded-sm bg-primary px-2 py-1 font-semibold text-[var(--text-on-accent)]"
        onClick={controller.attachSelectedText}
      >
        Attach to chat
      </button>
    </div>
  );
}

function TruncatedPreviewNotice({ sourceFileUrl }: { sourceFileUrl: string }) {
  return (
    <div
      role="status"
      className="mb-3 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
    >
      Preview limited to the first 64 KB.{' '}
      <a
        href={sourceFileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-foreground hover:underline"
      >
        Open the full source
      </a>
      .
    </div>
  );
}

function TextSource({ controller }: { controller: SourceModeController }) {
  const topPadding = controller.hasPdfPreview && controller.hasTextArtifact ? 'pt-12' : 'pt-6';
  return (
    <div className={cn('relative mx-auto w-full max-w-[768px] px-6 pb-6', topPadding)}>
      <SelectionToolbar controller={controller} />
      {controller.sourceTextPreviewTruncated
        ? <TruncatedPreviewNotice sourceFileUrl={controller.sourceFileUrl} />
        : null}
      <LatexEditor
        value={controller.sourceContent}
        fileName={controller.sourceFileName}
        fileUrl={controller.sourceFileUrl}
        lineWrapping
        fillHeight={false}
        pageScroll
        readonly
        latexLinting={false}
        extensions={controller.sourceSelectionExtensions}
      />
    </div>
  );
}

function SourceContent({ controller }: { controller: SourceModeController }) {
  if (controller.subView === 'pdf' && controller.hasPdf) {
    return <div className="relative min-h-0 min-w-0 flex-1"><PdfSource controller={controller} /></div>;
  }
  if (controller.isLoadingSourceText) return <SourceMessage>Loading source text…</SourceMessage>;
  if (controller.sourceTextLoadFailed) return <SourceMessage>Source text is unavailable.</SourceMessage>;
  if (controller.sourceContent) return <TextSource controller={controller} />;
  if (!controller.hasSource) return <EmptySource />;
  return null;
}

export function SourceModeView({ controller }: { controller: SourceModeController }) {
  const showPdf = controller.subView === 'pdf' && controller.hasPdf;
  return (
    <div className={cn('relative flex min-h-full', showPdf && 'h-full overflow-hidden')}>
      <div className="relative flex min-h-full min-w-0 flex-1 flex-col">
        <SourceSwitcher controller={controller} />
        <SourceContent controller={controller} />
        {controller.attachStatus ? (
          <div role="status" className="absolute bottom-4 right-6 z-20 rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background shadow-lg">
            {controller.attachStatus}
          </div>
        ) : null}
      </div>
    </div>
  );
}
