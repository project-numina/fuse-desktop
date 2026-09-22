import { useParams } from 'react-router-dom';

import { ChatProvider } from '@/state/chat';

import BlueprintWorkspaceView from './BlueprintWorkspaceView';
import type { BlueprintRouteIdentity } from './blueprint-page-types';
import { useBlueprintWorkspace } from './use-blueprint-workspace';
import { useBlueprintWorkspaceViewProps } from './use-blueprint-workspace-view-props';

export default function Blueprint() {
  const params = useParams();
  const route = {
    owner: params.owner ?? '',
    repo: params.repo ?? '',
    blueprintId: params.blueprintId ?? '',
  };
  const workspaceKey = `${route.owner}/${route.repo}/${route.blueprintId}`;
  return (
    <ChatProvider
      key={workspaceKey}
      options={{
        repositoryOwner: route.owner,
        repositoryName: route.repo,
        blueprintName: route.blueprintId,
      }}
    >
      <BlueprintWorkspace route={route} />
    </ChatProvider>
  );
}

function BlueprintWorkspace({ route }: { route: BlueprintRouteIdentity }) {
  const controller = useBlueprintWorkspace(route);
  const viewProps = useBlueprintWorkspaceViewProps(controller);
  return <BlueprintWorkspaceView {...viewProps} />;
}
