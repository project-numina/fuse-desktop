import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import type { BlueprintMode } from '@/features/blueprint/components/BlueprintSidebar';
import { URL_TO_MODE, blueprintModeUrl } from '@/features/blueprint/lib/blueprint-helpers';

import type { BlueprintRouteIdentity } from './blueprint-page-types';

export function useBlueprintModeRouting(route: BlueprintRouteIdentity) {
  const navigate = useNavigate();
  const location = useLocation();
  const modeParam = useParams().mode ?? 'home';
  const mode = (URL_TO_MODE[modeParam] ?? 'home') as BlueprintMode;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [mountedModes, setMountedModes] = useState<Set<BlueprintMode>>(
    () => new Set<BlueprintMode>(['home', mode]),
  );
  useEffect(() => {
    setMountedModes((previous) =>
      previous.has(mode) ? previous : new Set(previous).add(mode));
  }, [mode]);

  const baseUrl = `/repo/${route.owner}/${route.repo}/blueprint/${route.blueprintId}`;
  const handleModeChange = useCallback((next: BlueprintMode) => {
    navigate(blueprintModeUrl(baseUrl, next, location.search));
  }, [navigate, baseUrl, location.search]);
  const navigateHash = useCallback((hash: string, replace: boolean) => {
    navigate({
      pathname: location.pathname,
      search: location.search,
      hash: hash ? `#${hash}` : '',
    }, { replace });
  }, [navigate, location.pathname, location.search]);

  return {
    navigate,
    location,
    modeParam,
    mode,
    modeRef,
    mountedModes,
    baseUrl,
    handleModeChange,
    navigateHash,
  };
}
