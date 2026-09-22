import ConfirmDialog from '@/features/blueprint/components/ConfirmDialog';

import type { RemoveWorkspaceState } from './use-remove-workspace';

interface RemoveWorkspaceSectionProps {
  readonly: boolean;
  readonlyReason: string;
  state: RemoveWorkspaceState;
}

export function RemoveWorkspaceSection(props: RemoveWorkspaceSectionProps) {
  return (
    <section
      className="mt-10 flex flex-col gap-2 border-t border-[var(--numina-border-light)] pt-8"
      aria-labelledby="bp-remove-heading"
    >
      <h3 id="bp-remove-heading" className="m-0 text-sm font-semibold leading-[1.5] text-foreground">
        Remove workspace
      </h3>
      <p className="max-w-[60ch] text-xs leading-[1.5] text-muted-foreground">
        Forget this workspace and its chat history in Fuse. The folder and its files stay on
        disk untouched.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={props.readonly || props.state.removing}
          title={props.readonly ? props.readonlyReason : undefined}
          className="btn-outline-destructive px-4 py-2"
          onClick={props.state.openDialog}
        >
          Remove workspace
        </button>
        {props.state.error && (
          <p className="m-0 text-xs text-destructive">{props.state.error}</p>
        )}
      </div>
    </section>
  );
}

interface RemoveWorkspaceDialogProps {
  workspaceName: string;
  state: RemoveWorkspaceState;
}

export function RemoveWorkspaceDialog({ workspaceName, state }: RemoveWorkspaceDialogProps) {
  return (
    <ConfirmDialog
      open={state.dialogOpen}
      title="Remove this workspace?"
      message={`"${workspaceName}" and its chat history will be removed from Fuse. Files in the folder are not deleted.`}
      confirmLabel="Remove workspace"
      destructive
      busy={state.removing}
      onConfirm={() => void state.confirm()}
      onCancel={state.cancel}
    />
  );
}
