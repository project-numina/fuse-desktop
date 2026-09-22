import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { useNewBlueprintForm } from '@/features/blueprint/hooks/new-blueprint-form';
import { setDocumentTitle } from '@/lib/document-title';

export const NEW_BLUEPRINT_PAGE_TITLE = 'New workspace';

/** Connects route/query inputs to the new-workspace form workflow. */
export function useNewBlueprintPage() {
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? '';
  const repo = params.repo ?? '';
  const [searchParams] = useSearchParams();

  useEffect(() => {
    setDocumentTitle(NEW_BLUEPRINT_PAGE_TITLE);
  }, []);

  const form = useNewBlueprintForm({
    owner,
    repo,
    initialTitle: searchParams.get('title') ?? '',
    initialBaseBranch: searchParams.get('base') ?? '',
  });
  return { owner, repo, form };
}
