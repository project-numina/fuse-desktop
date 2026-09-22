/** React adapter for the route-stable Lean Infoview coordination machine. */

import { useEffect, useRef, useState } from 'react';
import { createInfoviewMachine } from './machine';
import { leanRequestErrorMessage } from './requests';
import {
  initialInfoviewState,
  type InfoviewApi,
  type InfoviewOptions,
  type InfoviewState,
} from './types';

export { leanRequestErrorMessage };
export type {
  DiagnosticItem,
  InfoviewApi,
  InfoviewState,
} from './types';

function exposedInfoviewState(state: InfoviewState, machine: InfoviewApi) {
  return {
    state,
    updateCursor: machine.updateCursor,
    saveAndRefresh: machine.saveAndRefresh,
    getPendingSaveContent: machine.getPendingSaveContent,
    flushPendingSave: machine.flushPendingSave,
    reloadFile: machine.reloadFile,
    refreshDiagnostics: machine.refreshDiagnostics,
    hover: machine.hover,
    dispose: machine.dispose,
  };
}

export function useInfoview(options: InfoviewOptions) {
  const { owner, repo, blueprintId, filePath, onPendingChange } = options;
  const stateRef = useRef<InfoviewState>(initialInfoviewState());
  const [state, setState] = useState<InfoviewState>(() => ({ ...stateRef.current }));
  const filePathRef = useRef<string | null>(filePath);
  filePathRef.current = filePath;
  const onPendingChangeRef = useRef(onPendingChange);
  onPendingChangeRef.current = onPendingChange;

  const publishRef = useRef<() => void>(() => {});
  publishRef.current = () => setState({ ...stateRef.current });

  // Route identifiers are stable for this hook instance, so the machine must
  // retain one identity across renders to preserve timers and request races.
  const machineRef = useRef<InfoviewApi | null>(null);
  if (machineRef.current === null) {
    machineRef.current = createInfoviewMachine({
      owner,
      repo,
      blueprintId,
      filePathRef,
      onPendingChangeRef,
      stateRef,
      publish: () => publishRef.current(),
    });
  }
  const machine = machineRef.current;

  useEffect(() => {
    machine.onFilePathChange();
    // The machine owns route-stable dependencies and reads the latest path ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  useEffect(() => () => machine.dispose(), [machine]);
  return exposedInfoviewState(state, machine);
}
