import { Link } from 'react-router-dom';

import MathText from '@/components/MathText';
import { timeAgo } from '@/lib/display';
import { cn } from '@/lib/utils';
import type {
  BlueprintSummary,
  PullRequestSummary,
} from '@/pages/repo/repo-helpers';
import type { RepoPageModel } from '@/pages/repo/use-repo-page';

const rowClass =
  'flex items-center gap-4 border-b border-[color:var(--numina-border-light)] py-3';
const metaClass = 'whitespace-nowrap text-[0.8125rem] text-muted-foreground';
const iconButtonClass =
  'flex cursor-pointer items-center justify-center border-none bg-transparent p-0 '
  + 'text-muted-foreground transition-colors';

function RepositoryHeader({ model }: { model: RepoPageModel }) {
  const { repository } = model;
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div>
        <h2 className="mb-0.5 text-2xl font-bold text-foreground">
          {repository?.name}
        </h2>
        {model.canRevealRepository ? (
          <button
            type="button"
            className="block max-w-full cursor-pointer truncate border-none bg-transparent p-0 text-left font-mono text-sm text-muted-foreground hover:underline"
            title="Show in folder"
            onClick={model.revealRepository}
          >
            {repository?.path}
          </button>
        ) : (
          <span className="block font-mono text-sm text-muted-foreground">
            {repository?.owner}/{repository?.name}
          </span>
        )}
        {repository?.description ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            {repository.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="btn-outline-accent flex-shrink-0 px-4 py-1.5"
        onClick={model.createBlueprint}
      >
        New workspace
      </button>
    </div>
  );
}

function UndoIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function WorkspaceDeleteAction({
  blueprint,
  model,
  pending,
}: {
  blueprint: BlueprintSummary;
  model: RepoPageModel;
  pending: boolean;
}) {
  if (pending) {
    return (
      <button
        type="button"
        className={cn(iconButtonClass, 'hover:text-foreground')}
        title="Undo delete"
        onClick={(event) => {
          event.stopPropagation();
          model.undoDelete(blueprint.id);
        }}
      >
        <UndoIcon />
      </button>
    );
  }
  if (blueprint.can_edit === false) return null;
  return (
    <button
      type="button"
      className={cn(iconButtonClass, 'hover:text-destructive')}
      title="Delete blueprint"
      onClick={(event) => {
        event.stopPropagation();
        model.requestDelete(blueprint.id);
      }}
    >
      <DeleteIcon />
    </button>
  );
}

function WorkspaceRow({
  blueprint,
  model,
}: {
  blueprint: BlueprintSummary;
  model: RepoPageModel;
}) {
  const pending = model.pendingDeletes.has(blueprint.id);
  const pullRequest = model.findBlueprintPullRequest(blueprint);
  return (
    <div className={cn(rowClass, pending && 'opacity-50')}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
        <Link
          className="text-sm font-semibold text-primary [overflow-wrap:anywhere] hover:underline"
          to={model.pathForBlueprint(blueprint)}
        >
          <MathText text={blueprint.name} preservePlainText />
        </Link>
        {pullRequest ? (
          <span
            className="text-xs font-medium text-muted-foreground"
            title={`PR #${pullRequest.number}`}
          >
            {model.pullRequestStatusLabel(pullRequest.status)}
          </span>
        ) : null}
      </div>
      {pending ? (
        <span className="whitespace-nowrap text-[0.8125rem] text-destructive">
          Deleted
        </span>
      ) : blueprint.updated_at ? (
        <span className={metaClass}>Updated {timeAgo(blueprint.updated_at)}</span>
      ) : (
        <span className={metaClass} />
      )}
      <div className="flex min-w-[2.625rem] items-center justify-end gap-3">
        <WorkspaceDeleteAction
          blueprint={blueprint}
          model={model}
          pending={pending}
        />
      </div>
    </div>
  );
}

function WorkspacesSection({ model }: { model: RepoPageModel }) {
  return (
    <section className="mb-8">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.05em] text-foreground">
        Workspaces
      </h3>
      {model.blueprints.length === 0 ? (
        <div className="py-3 text-sm text-muted-foreground">
          No active workspaces for this repository.
        </div>
      ) : (
        <div className="border-t border-[color:var(--numina-border-light)]">
          {model.blueprints.map((blueprint) => (
            <WorkspaceRow key={blueprint.id} blueprint={blueprint} model={model} />
          ))}
        </div>
      )}
    </section>
  );
}

function CompletedRow({
  model,
  pullRequest,
}: {
  model: RepoPageModel;
  pullRequest: PullRequestSummary;
}) {
  const blueprint = model.findPullRequestBlueprint(pullRequest);
  return (
    <div className={rowClass}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
        {blueprint ? (
          <button
            type="button"
            className="cursor-pointer border-none bg-transparent p-0 text-left text-sm font-semibold text-primary [overflow-wrap:anywhere] hover:underline"
            onClick={() => model.openPullRequestBlueprint(pullRequest)}
          >
            {pullRequest.title}
          </button>
        ) : (
          <span className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
            {pullRequest.title}
          </span>
        )}
      </div>
      <span className={metaClass}>
        Merged {timeAgo(pullRequest.merged_at ?? '')}
      </span>
    </div>
  );
}

function CompletedSection({ model }: { model: RepoPageModel }) {
  if (model.completedPullRequests.length === 0) return null;
  return (
    <section className="mb-8">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.05em] text-foreground">
        Completed
      </h3>
      <div className="border-t border-[color:var(--numina-border-light)]">
        {model.completedPullRequests.map((pullRequest) => (
          <CompletedRow
            key={pullRequest.number}
            model={model}
            pullRequest={pullRequest}
          />
        ))}
      </div>
    </section>
  );
}

export default function RepoView({ model }: { model: RepoPageModel }) {
  if (model.error) {
    return (
      <>
        <div className="py-12 text-center text-sm text-destructive">
          {model.error}
        </div>
        {model.deleteError ? (
          <p className="mt-2 text-sm text-destructive">{model.deleteError}</p>
        ) : null}
      </>
    );
  }
  return (
    <>
      <RepositoryHeader model={model} />
      <WorkspacesSection model={model} />
      <CompletedSection model={model} />
      {model.deleteError ? (
        <p className="mt-2 text-sm text-destructive">{model.deleteError}</p>
      ) : null}
    </>
  );
}
