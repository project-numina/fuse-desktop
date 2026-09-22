import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  buildBreadcrumbs,
  normalizeTreeRoot,
  parentPath,
} from '@/features/blueprint/components/changed-files-tree';

interface NavigationOptions {
  rootPath: string;
  selectedFile: string | null;
  onDirectoryChange?: (path: string) => void;
}

/** Keeps file-driven navigation inside the selected Lean project root. */
export function useChangedFilesNavigation({
  rootPath,
  selectedFile,
  onDirectoryChange,
}: NavigationOptions) {
  const treeRoot = normalizeTreeRoot(rootPath);
  const [override, setOverride] = useState<string | null>(null);
  const [lastSelectedFile, setLastSelectedFile] = useState(selectedFile);
  const [lastTreeRoot, setLastTreeRoot] = useState(treeRoot);
  let currentPath = override ?? treeRoot;

  if (treeRoot !== lastTreeRoot) {
    setLastTreeRoot(treeRoot);
    currentPath = treeRoot;
    setOverride(treeRoot);
  }
  if (selectedFile !== lastSelectedFile) {
    setLastSelectedFile(selectedFile);
    if (selectedFile) {
      const insideRoot = !treeRoot || selectedFile.startsWith(`${treeRoot}/`);
      const slash = selectedFile.lastIndexOf('/');
      currentPath = insideRoot
        ? (slash === -1 ? treeRoot : selectedFile.slice(0, slash))
        : treeRoot;
      setOverride(currentPath);
    }
  }

  useEffect(() => {
    onDirectoryChange?.(currentPath);
  }, [currentPath, onDirectoryChange]);
  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(currentPath, treeRoot),
    [currentPath, treeRoot],
  );
  const enterFolder = useCallback((path: string) => setOverride(path), []);
  const goHome = useCallback(() => setOverride(treeRoot), [treeRoot]);
  const goUp = useCallback(
    () => setOverride(parentPath(currentPath, treeRoot)),
    [currentPath, treeRoot],
  );
  return { treeRoot, currentPath, breadcrumbs, enterFolder, goHome, goUp };
}
