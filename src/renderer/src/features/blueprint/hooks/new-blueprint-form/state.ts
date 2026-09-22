import { useCallback, useRef, useState } from 'react';
import type { LakefileEntry } from '@/lib/api';

export function useCoreFormState(initialTitle: string) {
  const [blueprintTitle, setBlueprintTitle] = useState(initialTitle);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const existingIdsRef = useRef<Set<string>>(new Set());
  return {
    blueprintTitle, setBlueprintTitle, isSubmitting, setIsSubmitting,
    errorMessage, setErrorMessage, existingIdsRef,
  };
}

export function useBranchFormState() {
  const [baseBranch, setBaseBranchState] = useState('');
  const [repositoryBranches, setRepositoryBranches] = useState<string[]>([]);
  // Loading initially prevents submitting a guessed default branch.
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [branchesLoadFailed, setBranchesLoadFailedState] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState('');
  const baseBranchRef = useRef(baseBranch);
  const branchesLoadFailedRef = useRef(branchesLoadFailed);
  // Ref-first setters let a discovery started in the same tick observe the
  // new branch before React commits the corresponding render.
  const setBaseBranch = useCallback((value: string) => {
    baseBranchRef.current = value;
    setBaseBranchState(value);
  }, []);
  const setBranchesLoadFailed = useCallback((value: boolean) => {
    branchesLoadFailedRef.current = value;
    setBranchesLoadFailedState(value);
  }, []);
  return {
    baseBranch, setBaseBranch, baseBranchRef,
    repositoryBranches, setRepositoryBranches,
    isLoadingBranches, setIsLoadingBranches,
    branchesLoadFailed, setBranchesLoadFailed, branchesLoadFailedRef,
    branchSearchQuery, setBranchSearchQuery,
  };
}

export function useLakefileFormState() {
  const [lakefiles, setLakefiles] = useState<LakefileEntry[]>([]);
  const [lakefileSearchQuery, setLakefileSearchQuery] = useState('');
  const [selectedLakefileDir, setSelectedLakefileDirState] = useState('');
  // Avoid flashing the no-project state before initial discovery settles.
  const [isLoadingLakefiles, setIsLoadingLakefiles] = useState(true);
  const [lakefilesLoadFailed, setLakefilesLoadFailed] = useState(false);
  const [lakefilesTruncated, setLakefilesTruncated] = useState(false);
  const loadedForRef = useRef<string | null>(null);
  const loadingForRef = useRef<string | null>(null);
  const selectedLakefileDirRef = useRef(selectedLakefileDir);
  // Selection reconciliation runs after awaits, so it must read this mirror
  // rather than the render-time value captured by the request callback.
  const setSelectedLakefileDir = useCallback((value: string) => {
    selectedLakefileDirRef.current = value;
    setSelectedLakefileDirState(value);
  }, []);
  return {
    lakefiles, setLakefiles,
    lakefileSearchQuery, setLakefileSearchQuery,
    selectedLakefileDir, setSelectedLakefileDir, selectedLakefileDirRef,
    isLoadingLakefiles, setIsLoadingLakefiles,
    lakefilesLoadFailed, setLakefilesLoadFailed,
    lakefilesTruncated, setLakefilesTruncated,
    loadedForRef, loadingForRef,
  };
}

export type CoreFormState = ReturnType<typeof useCoreFormState>;
export type BranchFormState = ReturnType<typeof useBranchFormState>;
export type LakefileFormState = ReturnType<typeof useLakefileFormState>;
