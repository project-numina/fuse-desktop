import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SelectionIndicator } from '@/components/ui/selection-list';
import { Select } from '@/components/ui/select';
import SourceFilePickerDialog from '@/features/blueprint/components/SourceFilePickerDialog';

import type { LakefilePickerState } from './use-lakefile-picker';
import type { SourcePickerState } from './use-source-picker';

export function LakefilePickerDialog({ state }: { state: LakefilePickerState }) {
  const options = [
    { value: '', label: 'Choose a lakefile', disabled: true },
    ...state.lakefiles.map((file) => ({ value: file.path, label: file.path })),
  ];
  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a lakefile</DialogTitle>
          <DialogDescription>
            This selects the Lean project for this workspace. Setup still requires your confirmation.
          </DialogDescription>
        </DialogHeader>
        {state.loading ? (
          <p className="text-sm text-muted-foreground">Finding Lean projects…</p>
        ) : state.lakefiles.length ? (
          <Select
            ariaLabel="Lakefile"
            className="w-full"
            value={state.selected}
            onValueChange={state.setSelected}
            options={options}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No lakefile.lean or lakefile.toml found.</p>
        )}
        {state.truncated && (
          <p className="text-xs text-muted-foreground">
            Some projects may be missing from this large repository.
          </p>
        )}
        {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        <DialogFooter>
          <Button variant="ghost" disabled={state.saving} onClick={() => state.setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={state.loading || state.saving || !state.selected}
            onClick={() => void state.save()}
          >
            {state.saving ? 'Selecting…' : 'Use this project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BlueprintSourcePickerDialog({ state }: { state: SourcePickerState }) {
  return (
    <SourceFilePickerDialog
      open={state.open}
      files={state.files}
      selectedPath={state.selectedPath}
      loading={state.loading}
      saving={state.saving}
      error={state.error}
      description={(
        <>
          Pick an existing leanblueprint <code>.tex</code> entrypoint in this repository. Fuse
          re-parses its include chain and tracks it from there.
        </>
      )}
      savingLabel="Updating…"
      itemClassName="rounded-lg"
      selectedIndicator={<SelectionIndicator className="h-[18px] w-[18px]" />}
      footerClassName="mx-0 mb-0 flex-row border-0 bg-transparent p-0 pt-2"
      onOpenChange={(next) => { if (!next) state.closePicker(); }}
      onSelect={state.setSelectedPath}
      onConfirm={() => void state.confirm()}
    />
  );
}
