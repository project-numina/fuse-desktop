import type { ComponentProps } from 'react';
import { Link } from 'react-router-dom';

import AppHeader from '@/components/layout/AppHeader';
import MathText from '@/components/MathText';
import LeanSetupPrompt from '@/desktop/LeanSetupPrompt';
import ChatPanel from '@/features/chat/components/panel/ChatPanel';
import BlueprintSidebar, { type BlueprintMode, type SidebarOcrStatus } from '@/features/blueprint/components/BlueprintSidebar';
import SectionSelector from '@/features/blueprint/components/SectionSelector';
import BlueprintEmptyState from '@/features/blueprint/components/BlueprintEmptyState';
import HomeMode from '@/features/blueprint/components/HomeMode';
import GraphMode from '@/features/blueprint/components/GraphMode';
import EditMode from '@/features/blueprint/components/EditMode';
import LeanView from '@/features/blueprint/components/LeanView';
import GitMode from '@/features/blueprint/components/GitMode';
import HistoryMode from '@/features/blueprint/components/HistoryMode';
import SettingsMode from '@/features/blueprint/components/SettingsMode';

import type { BlueprintData, BlueprintRouteIdentity } from './blueprint-page-types';

interface BlueprintWorkspaceViewProps {
  route: BlueprintRouteIdentity;
  blueprint: BlueprintData | null;
  blueprintLabel: string;
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  mode: BlueprintMode;
  mountedModes: Set<BlueprintMode>;
  projectDirectory: string;
  sidebarOcrStatus: SidebarOcrStatus;
  onModeChange: (mode: BlueprintMode) => void;
  onNewChat: () => void;
  chatProps: ComponentProps<typeof ChatPanel>;
  homeProps: ComponentProps<typeof HomeMode>;
  graphProps: ComponentProps<typeof GraphMode>;
  emptyProps: ComponentProps<typeof BlueprintEmptyState>;
  editProps: ComponentProps<typeof EditMode>;
  gitProps: ComponentProps<typeof GitMode>;
  historyProps: ComponentProps<typeof HistoryMode>;
  settingsProps: ComponentProps<typeof SettingsMode>;
  leanProps: ComponentProps<typeof LeanView>;
  showSectionSelector: boolean;
  sectionProps: ComponentProps<typeof SectionSelector>;
}

const modeStyle = (mode: BlueprintMode, target: BlueprintMode) => ({
  display: mode === target ? undefined : 'none',
});

export default function BlueprintWorkspaceView(props: BlueprintWorkspaceViewProps) {
  const {
    route, blueprint, blueprintLabel, loading, error, canEdit, mode, mountedModes,
    projectDirectory, sidebarOcrStatus, onModeChange, onNewChat, chatProps,
    homeProps, graphProps, emptyProps, editProps, gitProps, historyProps,
    settingsProps, leanProps, showSectionSelector, sectionProps,
  } = props;
  const { owner, repo, blueprintId } = route;
  const isReadonly = !canEdit;
  const hasBlueprint = Boolean(blueprint?.blueprint_file);
  const breadcrumbs = (
    <div className="flex items-center gap-2 font-sans text-[0.9375rem] text-[var(--numina-border)]">
      <span>/</span>
      <Link to={`/repo/${owner}/${repo}`} className="text-[var(--text-muted)] transition-colors">
        {repo}
      </Link>
      <span>/</span>
      <MathText
        className="font-semibold text-[var(--text-primary)]"
        text={blueprintLabel}
        macros={blueprint?.latex_macros}
        preservePlainText
      />
      {isReadonly && <span className="pr-status" title="This workspace is read-only.">Read-only</span>}
    </div>
  );

  return (
    <div className="blueprint-page flex h-screen flex-col overflow-hidden">
      <AppHeader breadcrumbs={breadcrumbs} loading={loading && !error} />
      {error ? (
        <div className="flex flex-1 items-center justify-center text-sm text-red-600">{error}</div>
      ) : loading || !blueprint ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading blueprint…
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <BlueprintSidebar
            footer={<LeanSetupPrompt key={projectDirectory} owner={owner} repo={repo} blueprintId={blueprintId} showLauncher />}
            owner={owner}
            repository={repo}
            blueprintId={blueprintId}
            mode={mode}
            sourceType={blueprint.source_type || ''}
            readonly={isReadonly}
            ocrStatus={sidebarOcrStatus}
            onModeChange={onModeChange}
            onNewChat={onNewChat}
          />
          <ChatPanel {...chatProps} />
          <div
            className="content-area min-h-0 min-w-0 flex-1 overflow-y-auto"
            style={{ display: mode === 'view' ? 'none' : undefined }}
          >
            {mountedModes.has('home') && (
              <div style={modeStyle(mode, 'home')}><HomeMode {...homeProps} /></div>
            )}
            {mountedModes.has('graph') && (
              <div style={modeStyle(mode, 'graph')} className="h-full min-h-0">
                <GraphMode {...graphProps} />
              </div>
            )}
            {mode === 'edit' && !hasBlueprint ? (
              <BlueprintEmptyState {...emptyProps} />
            ) : mountedModes.has('edit') && hasBlueprint ? (
              <div style={modeStyle(mode, 'edit')}><EditMode {...editProps} /></div>
            ) : null}
            {mountedModes.has('git') && (
              <div style={modeStyle(mode, 'git')} className="h-full min-h-0">
                <GitMode {...gitProps} />
              </div>
            )}
            {mountedModes.has('history') && (
              <div style={modeStyle(mode, 'history')}><HistoryMode {...historyProps} /></div>
            )}
            {mountedModes.has('settings') && (
              <div style={modeStyle(mode, 'settings')}><SettingsMode {...settingsProps} /></div>
            )}
          </div>
          {mountedModes.has('view') && (
            <div
              style={modeStyle(mode, 'view')}
              className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
            >
              <LeanView {...leanProps} />
            </div>
          )}
          {showSectionSelector && <SectionSelector {...sectionProps} />}
        </div>
      )}
    </div>
  );
}
