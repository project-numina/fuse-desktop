import 'katex/dist/katex.min.css';

import type { ChapterDescriptor } from '@/features/blueprint/hooks/chapter';
import type { MacroDict } from '@/lib/latex-macros';
import { cn } from '@/lib/utils';

import { useHomeDocument } from './home-mode/use-home-document';
import { useHomeNavigation } from './home-mode/use-home-navigation';

export interface BlueprintEntry {
  kind: string;
  label: string;
  title: string;
  statement: string;
  proof?: string | null;
  uses?: string[];
  lean_name?: string;
  leanName?: string;
  issues?: string[];
  source_file?: string;
  sourceFile?: string;
  lean_file?: string;
  leanFile?: string;
  lean_line?: number;
  leanLine?: number;
  status?: string;
}

export interface HomeModeBlueprint {
  name?: string;
  description?: string;
  blueprint_file?: string;
  blueprint_content?: string;
  included_files?: string[];
  entries?: BlueprintEntry[];
  latex_macros?: MacroDict;
  chapter_references?: Record<string, string>;
  chapter_contents?: Record<string, string>;
}

export interface HomeModeProps {
  blueprint: HomeModeBlueprint;
  entries?: BlueprintEntry[];
  hasMultipleChapters?: boolean;
  chapters?: ChapterDescriptor[];
  activeChapterPath?: string;
  chapterContent?: string;
  onSelectChapter?: (path: string) => void | Promise<boolean | void>;
  onOpenLeanFile?: (file: string, line?: number) => void;
  currentHash?: string;
  onNavigateHash?: (hash: string, replace: boolean) => void;
  onAutoSelectChapter?: (path: string) => void;
  restoredFromStorage?: boolean;
  userNavigated?: boolean;
  className?: string;
}

function HomeEmptyState() {
  return (
    <div className="flex min-h-[calc(100vh-160px)] w-full items-start justify-center pt-[var(--empty-state-anchor)]">
      <div className="flex max-w-[320px] flex-col items-center gap-3 text-center">
        <p className="m-0 text-lg font-semibold text-foreground">No declarations yet</p>
        <p className="m-0 max-w-[320px] text-sm leading-relaxed text-muted-foreground">
          Switch to the{' '}
          <strong className="font-semibold text-[var(--text-body)]">Blueprint</strong>{' '}
          tab to define
          <br />
          theorems, lemmas, and definitions.
        </p>
      </div>
    </div>
  );
}

function HomeDocument({
  props,
  model,
  navigation,
}: {
  props: HomeModeProps;
  model: ReturnType<typeof useHomeDocument>;
  navigation: ReturnType<typeof useHomeNavigation>;
}) {
  const { blueprint, hasMultipleChapters = false, className } = props;
  const {
    activeChapterSource, activeChapterFile, sectionNumber,
    sourceHasOwnHeading, renderedBody,
  } = model;
  return (
    <div className={cn('flex min-h-full w-full flex-row items-start', className)}>
      <div className="min-w-0 flex-1">
        <div className="mx-auto px-6 py-10" style={{ maxWidth: 614 }}>
          {!sourceHasOwnHeading && (
            <h1 className="mb-4 text-2xl font-semibold leading-tight text-foreground">
              {blueprint.name ?? ''}
            </h1>
          )}
          {!sourceHasOwnHeading && activeChapterFile && (
            <p className="doc-chapter-file">{activeChapterFile}</p>
          )}
          {!sourceHasOwnHeading && !hasMultipleChapters && blueprint.description && (
            <p className="mb-4 text-sm leading-relaxed text-[var(--text-body)]">
              {blueprint.description}
            </p>
          )}
          {hasMultipleChapters && !activeChapterSource ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No content in this chapter.
            </div>
          ) : (
            <div
              ref={navigation.docBodyRef}
              className="doc-body"
              style={{
                counterReset: `doc-section ${sectionNumber} doc-item 0 doc-subsection 0 doc-subsubsection 0`,
              }}
              onClick={navigation.handleBodyClick}
              onKeyDown={navigation.handleBodyKeyDown}
              dangerouslySetInnerHTML={{ __html: renderedBody }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Blueprint overview rendered from the active chapter's LaTeX source. */
export default function HomeMode(props: HomeModeProps) {
  const model = useHomeDocument(props);
  const navigation = useHomeNavigation(props, model);
  return model.isEmpty
    ? <HomeEmptyState />
    : <HomeDocument props={props} model={model} navigation={navigation} />;
}
