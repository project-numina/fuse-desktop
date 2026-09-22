/** Source preview facade for repository-backed and legacy blueprint sources. */

import { SourceModeView } from './source-mode/SourceModeView';
import { useSourceMode } from './source-mode/use-source-mode';
import type { SourceModeProps } from './source-mode/model';

export type { SourceModeBlueprint, SourceModeProps } from './source-mode/model';

function SourceMode(props: SourceModeProps) {
  return <SourceModeView controller={useSourceMode(props)} />;
}

export default SourceMode;
