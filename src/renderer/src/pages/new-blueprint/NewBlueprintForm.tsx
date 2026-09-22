import { Button } from '@/components/ui/button';
import {
  SelectionIndicator,
  SelectionList,
  SelectionListEmpty,
  SelectionListItem,
  SelectionListSearch,
} from '@/components/ui/selection-list';
import type { useNewBlueprintForm } from '@/features/blueprint/hooks/new-blueprint-form';
import { cn } from '@/lib/utils';
import { NEW_BLUEPRINT_PAGE_TITLE } from '@/pages/new-blueprint/use-new-blueprint-page';

export type NewBlueprintFormState = ReturnType<typeof useNewBlueprintForm>;

function TitleField({ form }: { form: NewBlueprintFormState }) {
  return (
    <>
      <label
        htmlFor="blueprint-title"
        className="mb-1.5 block text-sm font-medium text-foreground"
      >
        Title <span className="text-destructive">*</span>
      </label>
      <SelectionListSearch
        id="blueprint-title"
        value={form.blueprintTitle}
        onChange={(event) => form.setBlueprintTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void form.handleCreate();
          }
        }}
        type="text"
        autoFocus
        placeholder="e.g., Fundamental Theorem of Calculus"
        className={cn(
          'mb-6',
          form.errorMessage && 'border-destructive focus-visible:border-destructive',
        )}
      />
      {form.errorMessage ? (
        <p className="-mt-4 mb-4 text-xs text-destructive">{form.errorMessage}</p>
      ) : null}
    </>
  );
}

function BranchDescription() {
  return (
    <>
      <span className="mb-1.5 block text-sm font-medium text-foreground">Branch</span>
      <p className="mb-6 text-sm text-muted-foreground">
        The workspace runs in this folder on the branch that is checked out.
        Switch branches in git first if you want it somewhere else.
      </p>
    </>
  );
}

function NoLakefilesMessage({ truncated }: { truncated: boolean }) {
  return (
    <div className="px-3 py-2">
      <SelectionListEmpty className="p-0">
        {truncated
          ? 'This folder is too large to scan fully, so a Lean project may have been missed. Press Create to set one up.'
          : 'No Lean project found in this folder. Press Create to set one up.'}
      </SelectionListEmpty>
    </div>
  );
}

function LeanProjectOptions({ form }: { form: NewBlueprintFormState }) {
  if (form.isLoadingLakefiles) {
    return <SelectionListEmpty>Finding Lean projects…</SelectionListEmpty>;
  }
  if (form.lakefilesLoadFailed) {
    return (
      <SelectionListEmpty>
        Could not detect Lean projects in this folder. The blueprint will build
        against the repository root.
      </SelectionListEmpty>
    );
  }
  if (form.lakefiles.length === 0) {
    return <NoLakefilesMessage truncated={form.lakefilesTruncated} />;
  }
  if (form.filteredLakefiles.length === 0) {
    return (
      <SelectionListEmpty>
        No Lean projects match "{form.lakefileSearchQuery}".
      </SelectionListEmpty>
    );
  }
  return form.filteredLakefiles.map((entry) => (
    <SelectionListItem
      key={entry.path}
      selected={entry.directory === form.selectedLakefileDir}
      onClick={() => form.selectLakefile(entry)}
    >
      <span className="min-w-0 font-mono text-sm text-foreground [overflow-wrap:anywhere]">
        {entry.path}
      </span>
      {entry.directory === form.selectedLakefileDir ? <SelectionIndicator /> : null}
    </SelectionListItem>
  ));
}

function LeanProjectPicker({ form }: { form: NewBlueprintFormState }) {
  return (
    <>
      <label
        htmlFor="lean-project-search"
        className="mb-1.5 block text-sm font-medium text-foreground"
      >
        Lean project <span className="text-destructive">*</span>
      </label>
      <SelectionListSearch
        id="lean-project-search"
        value={form.lakefileSearchQuery}
        onChange={(event) => form.setLakefileSearchQuery(event.target.value)}
        type="search"
        className="mb-2"
        placeholder="Search Lean projects…"
        autoComplete="off"
        spellCheck={false}
        disabled={
          form.isLoadingLakefiles
          || form.lakefilesLoadFailed
          || form.lakefiles.length === 0
        }
      />
      <SelectionList aria-label="Lean project">
        <LeanProjectOptions form={form} />
      </SelectionList>
      {form.lakefilesTruncated && form.lakefiles.length > 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          This folder is too large to scan fully. Some Lean projects may be missing;
          open a more specific project folder to find them.
        </p>
      ) : null}
    </>
  );
}

function FormActions({ form }: { form: NewBlueprintFormState }) {
  let createLabel = 'Create workspace';
  if (form.noLakefileFound) createLabel = 'Set up Lean project';
  else if (form.isSubmitting) createLabel = 'Creating...';
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        className="px-6"
        disabled={form.isSubmitting}
        onClick={() => void form.handleCreate()}
      >
        {createLabel}
      </Button>
      <Button type="button" variant="outline" className="px-6" onClick={form.goBack}>
        Cancel
      </Button>
    </div>
  );
}

/** Presentation for the desktop new-workspace workflow. */
export default function NewBlueprintForm({ form }: { form: NewBlueprintFormState }) {
  return (
    <div className="numina-card p-8">
      <h2 className="mb-6 text-xl font-bold text-foreground">
        {NEW_BLUEPRINT_PAGE_TITLE}
      </h2>
      <TitleField form={form} />
      <BranchDescription />
      <LeanProjectPicker form={form} />
      <FormActions form={form} />
    </div>
  );
}
