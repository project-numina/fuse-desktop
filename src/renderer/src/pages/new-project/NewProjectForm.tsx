import { Button } from '@/components/ui/button';
import {
  SelectionIndicator,
  SelectionList,
  SelectionListEmpty,
  SelectionListItem,
  SelectionListSearch,
} from '@/components/ui/selection-list';
import { cn } from '@/lib/utils';
import {
  MATHLIB_DEFAULT_VERSION_ID,
  TOTAL_STEPS,
  type WizardStep,
} from '@/pages/new-project/new-project-helpers';
import type { NewProjectWorkflow } from '@/pages/new-project/use-new-project-workflow';

const stepTitles: Record<WizardStep, string> = {
  1: 'Pick the folder',
  2: 'Project settings',
};
const helpClass = 'mt-1.5 text-xs leading-normal text-muted-foreground';
const folderCtaClass =
  'flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-foreground px-4 py-3 '
  + 'text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-default disabled:opacity-50';

function FolderIcon() {
  return (
    <svg
      className="h-[1.125rem] w-[1.125rem] flex-shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function StepProgress({ step }: { step: WizardStep }) {
  return (
    <div className="mb-5 flex gap-2">
      {Array.from({ length: TOTAL_STEPS }, (_, index) => index + 1).map((index) => (
        <span
          key={index}
          className={cn(
            'rounded-full border px-2 py-0.5 font-mono text-xs font-medium tracking-[0.04em] transition-colors',
            index === step && 'border-primary bg-primary text-primary-foreground',
            index < step && 'border-primary text-primary opacity-60',
            index > step
              && 'border-[color:var(--numina-border-light)] text-muted-foreground',
          )}
        >
          {String(index).padStart(2, '0')}
        </span>
      ))}
    </div>
  );
}

function RepositoryOptions({ workflow }: { workflow: NewProjectWorkflow }) {
  if (workflow.isLoadingRepositories) {
    return <SelectionListEmpty>Loading folders…</SelectionListEmpty>;
  }
  if (workflow.availableRepos.length === 0) {
    return <SelectionListEmpty>No folders opened yet.</SelectionListEmpty>;
  }
  if (workflow.filteredRepos.length === 0) {
    return (
      <SelectionListEmpty>
        No folders match "{workflow.repoSearchQuery}".
      </SelectionListEmpty>
    );
  }
  return workflow.filteredRepos.map((repository) => (
    <SelectionListItem
      key={repository.id}
      selected={repository.id === workflow.selectedRepoId}
      onClick={() => workflow.setSelectedRepoId(repository.id)}
    >
      <span>{repository.owner}/{repository.name}</span>
      {repository.id === workflow.selectedRepoId ? <SelectionIndicator /> : null}
    </SelectionListItem>
  ));
}

function FolderStep({ workflow }: { workflow: NewProjectWorkflow }) {
  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        Pick a folder that is already open, or choose a new one. Fuse will add a
        lakefile, lean-toolchain, and starter module to it in the next step.
      </p>
      <button
        type="button"
        className={cn(folderCtaClass, 'mb-6')}
        disabled={!workflow.isDesktopAvailable || workflow.isOpeningFolder}
        title={workflow.isDesktopAvailable ? undefined : 'Available in the desktop app.'}
        onClick={() => void workflow.chooseFolder()}
      >
        <FolderIcon />
        <span>{workflow.isOpeningFolder ? 'Opening…' : 'Choose folder…'}</span>
      </button>
      <label
        htmlFor="setup-repo-search"
        className="mb-1.5 block text-sm font-medium text-foreground"
      >
        Folder
      </label>
      <SelectionListSearch
        id="setup-repo-search"
        value={workflow.repoSearchQuery}
        onChange={(event) => workflow.setRepoSearchQuery(event.target.value)}
        type="search"
        className="mb-2"
        placeholder="Search folders…"
        autoComplete="off"
        spellCheck={false}
        disabled={workflow.isLoadingRepositories || workflow.availableRepos.length === 0}
      />
      <SelectionList aria-label="Folder">
        <RepositoryOptions workflow={workflow} />
      </SelectionList>
    </>
  );
}

function ProjectFields({ workflow }: { workflow: NewProjectWorkflow }) {
  return (
    <>
      <label
        htmlFor="setup-module"
        className="mb-1.5 block text-sm font-medium text-foreground"
      >
        Module name
      </label>
      <SelectionListSearch
        id="setup-module"
        type="text"
        className="mb-1"
        value={workflow.moduleName}
        placeholder="FLT"
        autoComplete="off"
        spellCheck={false}
        onChange={workflow.onModuleNameInput}
      />
      <p className={cn(helpClass, 'mb-4')}>
        Top-level Lean library name. Must start with a capital letter.
      </p>
      <label
        htmlFor="setup-subdir"
        className="mb-1.5 block text-sm font-medium text-foreground"
      >
        Subfolder (optional)
      </label>
      <SelectionListSearch
        id="setup-subdir"
        value={workflow.targetSubdir}
        onChange={(event) => workflow.setTargetSubdir(event.target.value)}
        type="text"
        className="mb-1"
        placeholder="e.g., lean"
        autoComplete="off"
        spellCheck={false}
      />
      <p className={cn(helpClass, 'mb-4')}>
        Leave blank to create the project at the folder root. Use a subfolder to
        add a project to a folder that already has one.
      </p>
    </>
  );
}

function LeanVersionOptions({ workflow }: { workflow: NewProjectWorkflow }) {
  if (workflow.isLoadingLeanVersions) {
    return <SelectionListEmpty>Loading Lean releases…</SelectionListEmpty>;
  }
  if (workflow.stableLeanVersionTags.length === 0) {
    return (
      <SelectionListEmpty>
        Could not load Lean releases. The Mathlib pin will be used.
      </SelectionListEmpty>
    );
  }
  return workflow.stableLeanVersionTags.map((tag) => (
    <SelectionListItem
      key={tag.name}
      selected={workflow.selectedLeanVersionId === tag.name}
      onClick={() => workflow.setSelectedLeanVersionId(tag.name)}
    >
      <span>{tag.name}</span>
      {workflow.selectedLeanVersionId === tag.name ? <SelectionIndicator /> : null}
    </SelectionListItem>
  ));
}

function LeanVersionPicker({ workflow }: { workflow: NewProjectWorkflow }) {
  const useMathlibDefault = workflow.selectedLeanVersionId
    === MATHLIB_DEFAULT_VERSION_ID;
  return (
    <>
      <hr className="mb-4 border-t border-[color:var(--numina-border-light)]" />
      <p className="mb-1.5 block text-sm font-medium text-foreground">
        Lean version
      </p>
      <SelectionList aria-label="Lean version">
        <SelectionListItem
          selected={useMathlibDefault}
          onClick={() => workflow.setSelectedLeanVersionId(MATHLIB_DEFAULT_VERSION_ID)}
        >
          <span>Match Mathlib (recommended)</span>
          {useMathlibDefault ? <SelectionIndicator /> : null}
        </SelectionListItem>
        <LeanVersionOptions workflow={workflow} />
      </SelectionList>
    </>
  );
}

function ProjectSettingsStep({ workflow }: { workflow: NewProjectWorkflow }) {
  return (
    <>
      <p className="mb-6 text-sm text-muted-foreground">
        Name your top-level Lean library and pick a Lean release.
      </p>
      <ProjectFields workflow={workflow} />
      <LeanVersionPicker workflow={workflow} />
    </>
  );
}

function WizardActions({ workflow }: { workflow: NewProjectWorkflow }) {
  const cancel = workflow.step === 1
    ? workflow.goBack
    : workflow.previousStep;
  return (
    <div className="mt-8 flex items-center gap-3">
      {workflow.step < TOTAL_STEPS ? (
        <Button type="button" variant="outline" className="px-6" onClick={workflow.nextStep}>
          Next
        </Button>
      ) : (
        <Button
          type="button"
          className="px-6"
          disabled={!workflow.canSubmit}
          onClick={() => void workflow.handleCreate()}
        >
          {workflow.isSubmitting ? 'Creating…' : 'Create'}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        className="px-6"
        disabled={workflow.isSubmitting}
        onClick={cancel}
      >
        {workflow.step === 1 || workflow.directMode ? 'Cancel' : 'Back'}
      </Button>
    </div>
  );
}

export default function NewProjectForm({
  workflow,
}: {
  workflow: NewProjectWorkflow;
}) {
  return (
    <div className="numina-card p-8">
      {!workflow.directMode ? <StepProgress step={workflow.step} /> : null}
      <h2 className="mb-2 text-xl font-bold text-foreground">
        {stepTitles[workflow.step]}
      </h2>
      {workflow.step === 1
        ? <FolderStep workflow={workflow} />
        : <ProjectSettingsStep workflow={workflow} />}
      {workflow.errorMessage ? (
        <p className="mb-2 mt-4 text-sm text-destructive">
          {workflow.errorMessage}
        </p>
      ) : null}
      <WizardActions workflow={workflow} />
    </div>
  );
}
