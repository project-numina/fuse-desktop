import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { isDesktop, pickAndRegisterFolder } from '@/desktop/bridge';
import { ApiError, fetchLean4Tags, setupRepository, type Lean4Tag } from '@/lib/api';
import { setDocumentTitle } from '@/lib/document-title';
import { useDashboard, type Repository } from '@/state/dashboard';
import {
  blueprintContinuationPath,
  isValidModuleName,
  MATHLIB_DEFAULT_VERSION_ID,
  sanitizeModuleName,
  sanitizeTargetSubdir,
  setupErrorMessage,
  stableLeanVersions,
  TOTAL_STEPS,
  type WizardStep,
} from '@/pages/new-project/new-project-helpers';

interface DirectRoute {
  owner: string;
  repository: string;
  baseBranch: string;
  blueprintTitle: string;
  enabled: boolean;
}

type DashboardLoad = ReturnType<typeof useDashboard>['load'];
type Navigate = ReturnType<typeof useNavigate>;
type SetState<T> = Dispatch<SetStateAction<T>>;

function readDirectRoute(searchParams: URLSearchParams): DirectRoute {
  const owner = searchParams.get('owner') ?? '';
  const repository = searchParams.get('repo') ?? '';
  return {
    owner,
    repository,
    baseBranch: searchParams.get('base') ?? '',
    blueprintTitle: searchParams.get('title') ?? '',
    enabled: owner !== '' && repository !== '',
  };
}

function filterRepositories(repositories: Repository[], query: string): Repository[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return repositories;
  return repositories.filter((repository) =>
    `${repository.owner}/${repository.name}`.toLowerCase().includes(normalizedQuery),
  );
}

function useRepositoryPicker(availableRepos: Repository[], directRoute: DirectRoute) {
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const selectedRepoIdRef = useRef(selectedRepoId);
  selectedRepoIdRef.current = selectedRepoId;
  const selectedRepo = useMemo(
    () => availableRepos.find((repository) => repository.id === selectedRepoId) ?? null,
    [availableRepos, selectedRepoId],
  );
  const filteredRepos = useMemo(
    () => filterRepositories(availableRepos, repoSearchQuery),
    [availableRepos, repoSearchQuery],
  );

  useEffect(() => {
    if (directRoute.enabled) {
      if (selectedRepoIdRef.current === null) {
        const match = availableRepos.find(
          (repo) => repo.owner === directRoute.owner
            && repo.name === directRoute.repository,
        );
        if (match) setSelectedRepoId(match.id);
      }
      return;
    }
    if (selectedRepoIdRef.current === null && availableRepos.length > 0) {
      setSelectedRepoId(availableRepos[0].id);
    }
  }, [availableRepos, directRoute.enabled, directRoute.owner, directRoute.repository]);

  return {
    filteredRepos,
    repoSearchQuery,
    selectedRepo,
    selectedRepoId,
    setRepoSearchQuery,
    setSelectedRepoId,
  };
}

function useLeanVersionPicker(step: WizardStep) {
  const [tags, setTags] = useState<Lean4Tag[]>([]);
  const [isLoadingLeanVersions, setIsLoading] = useState(false);
  const [selectedLeanVersionId, setSelectedLeanVersionId] = useState(
    MATHLIB_DEFAULT_VERSION_ID,
  );
  const startedRef = useRef(false);
  const didMountStepRef = useRef(false);
  const loadLeanVersionsOnce = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setIsLoading(true);
    try {
      setTags(await fetchLean4Tags());
    } catch {
      // The picker retains the Mathlib default if releases are unavailable.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!didMountStepRef.current) {
      didMountStepRef.current = true;
      return;
    }
    if (step === 2) void loadLeanVersionsOnce();
  }, [loadLeanVersionsOnce, step]);

  return {
    isLoadingLeanVersions,
    loadLeanVersionsOnce,
    selectedLeanVersionId,
    setSelectedLeanVersionId,
    stableLeanVersionTags: useMemo(() => stableLeanVersions(tags), [tags]),
  };
}

function useProjectFields(selectedRepo: Repository | null) {
  const [moduleName, setModuleName] = useState('');
  const [targetSubdir, setTargetSubdir] = useState('');
  const moduleNameTouchedRef = useRef(false);

  useEffect(() => {
    if (!moduleNameTouchedRef.current && selectedRepo) {
      setModuleName(sanitizeModuleName(selectedRepo.name));
    }
  }, [selectedRepo]);

  const onModuleNameInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    moduleNameTouchedRef.current = true;
    setModuleName(event.target.value);
  }, []);

  return {
    moduleName,
    moduleNameValid: isValidModuleName(moduleName),
    onModuleNameInput,
    setTargetSubdir,
    targetSubdir,
  };
}

function useRepositoryLoader(load: DashboardLoad) {
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(true);
  const refreshRepositories = useCallback(async (force = false) => {
    setIsLoadingRepositories(true);
    try {
      await load({ force });
    } finally {
      setIsLoadingRepositories(false);
    }
  }, [load]);
  return { isLoadingRepositories, refreshRepositories };
}

function useWorkflowBootstrap(
  refreshRepositories: (force?: boolean) => Promise<void>,
  loadLeanVersionsOnce: () => Promise<void>,
  directMode: boolean,
) {
  const didBootstrapRef = useRef(false);
  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;
    void refreshRepositories();
    if (directMode) void loadLeanVersionsOnce();
    // Mount bootstrap intentionally runs once; callbacks read stable store APIs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useFolderChooser(
  setSelectedRepoId: SetState<number | null>,
  setErrorMessage: SetState<string>,
) {
  const [isOpeningFolder, setIsOpeningFolder] = useState(false);
  const chooseFolder = useCallback(async () => {
    if (isOpeningFolder) return;
    setErrorMessage('');
    setIsOpeningFolder(true);
    try {
      const repository = await pickAndRegisterFolder();
      if (repository) setSelectedRepoId(repository.id);
    } catch (caught) {
      setErrorMessage(
        caught instanceof ApiError
          ? caught.message
          : 'Could not open that folder. Please try again.',
      );
    } finally {
      setIsOpeningFolder(false);
    }
  }, [isOpeningFolder, setErrorMessage, setSelectedRepoId]);
  return { chooseFolder, isOpeningFolder };
}

function useWizardNavigation(
  step: WizardStep,
  setStep: SetState<WizardStep>,
  selectedRepo: Repository | null,
  directMode: boolean,
  navigate: Navigate,
  setErrorMessage: SetState<string>,
) {
  const nextStep = useCallback(() => {
    setErrorMessage('');
    if (step === 1 && selectedRepo === null) {
      setErrorMessage('Pick a folder before continuing.');
      return;
    }
    if (step < TOTAL_STEPS) setStep((step + 1) as WizardStep);
  }, [selectedRepo, setErrorMessage, setStep, step]);
  const previousStep = useCallback(() => {
    setErrorMessage('');
    if (directMode) {
      navigate(-1);
      return;
    }
    if (step > 1) setStep((step - 1) as WizardStep);
  }, [directMode, navigate, setErrorMessage, setStep, step]);
  const goBack = useCallback(() => navigate('/'), [navigate]);
  return { goBack, nextStep, previousStep };
}

interface CreationOptions {
  directRoute: DirectRoute;
  fields: ReturnType<typeof useProjectFields>;
  leanVersionId: string;
  load: DashboardLoad;
  navigate: Navigate;
  selectedRepo: Repository | null;
  setErrorMessage: SetState<string>;
  setIsSubmitting: SetState<boolean>;
}

function directContinuationPath(route: DirectRoute): string {
  return blueprintContinuationPath({
    owner: route.owner,
    repository: route.repository,
    title: route.blueprintTitle,
    baseBranch: route.baseBranch,
  });
}

async function createProject(options: CreationOptions) {
  const {
    directRoute, fields, leanVersionId, load, navigate, selectedRepo,
    setErrorMessage, setIsSubmitting,
  } = options;
  setErrorMessage('');
  if (!selectedRepo) {
    setErrorMessage('Pick a folder to set up.');
    return;
  }
  if (!fields.moduleNameValid) {
    setErrorMessage(
      'Module name must start with a capital letter and contain only letters, digits, and underscores.',
    );
    return;
  }
  const leanVersion = leanVersionId === MATHLIB_DEFAULT_VERSION_ID ? undefined : leanVersionId;
  const subdir = sanitizeTargetSubdir(fields.targetSubdir);
  setIsSubmitting(true);
  try {
    await setupRepository(
      selectedRepo.owner,
      selectedRepo.name,
      fields.moduleName.trim(),
      leanVersion,
      subdir || undefined,
    );
    if (directRoute.enabled) {
      navigate(directContinuationPath(directRoute));
      return;
    }
    await load({ force: true });
    navigate(`/repo/${selectedRepo.owner}/${selectedRepo.name}`);
  } catch (caught) {
    setErrorMessage(setupErrorMessage(caught));
  } finally {
    setIsSubmitting(false);
  }
}

function useProjectCreation(options: Omit<CreationOptions, 'setIsSubmitting'>) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleCreate = useCallback(
    () => createProject({ ...options, setIsSubmitting }),
    [options],
  );
  return { handleCreate, isSubmitting };
}

/** Owns setup-wizard state, asynchronous bootstrap, submission, and routing. */
export function useNewProjectWorkflow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { state: dashboardState, load } = useDashboard();
  const directRoute = readDirectRoute(searchParams);
  const availableRepos = dashboardState.repositories;
  const [step, setStep] = useState<WizardStep>(directRoute.enabled ? 2 : 1);
  const [errorMessage, setErrorMessage] = useState('');
  const { selectedRepo, ...repositoryPicker } = useRepositoryPicker(availableRepos, directRoute);
  const { moduleNameValid, ...projectFields } = useProjectFields(selectedRepo);
  const { loadLeanVersionsOnce, ...leanVersionPicker } = useLeanVersionPicker(step);
  const { refreshRepositories, ...repositoryLoading } = useRepositoryLoader(load);
  useEffect(() => setDocumentTitle('New Project'), []);
  useWorkflowBootstrap(refreshRepositories, loadLeanVersionsOnce, directRoute.enabled);
  const folderChooser = useFolderChooser(repositoryPicker.setSelectedRepoId, setErrorMessage);
  const navigation = useWizardNavigation(
    step, setStep, selectedRepo, directRoute.enabled, navigate, setErrorMessage,
  );
  const creation = useProjectCreation({
    directRoute, fields: { ...projectFields, moduleNameValid },
    leanVersionId: leanVersionPicker.selectedLeanVersionId,
    load, navigate, selectedRepo, setErrorMessage,
  });

  return {
    availableRepos,
    canSubmit: selectedRepo !== null && moduleNameValid && !creation.isSubmitting,
    directMode: directRoute.enabled,
    errorMessage,
    isDesktopAvailable: isDesktop(),
    step,
    ...repositoryPicker,
    ...projectFields,
    ...leanVersionPicker,
    ...repositoryLoading,
    ...folderChooser,
    ...navigation,
    ...creation,
  };
}

export type NewProjectWorkflow = ReturnType<typeof useNewProjectWorkflow>;
