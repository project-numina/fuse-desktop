import { Link } from 'react-router-dom';

import AppFooter from '@/components/layout/AppFooter';
import AppHeader from '@/components/layout/AppHeader';
import NewBlueprintForm from '@/pages/new-blueprint/NewBlueprintForm';
import {
  NEW_BLUEPRINT_PAGE_TITLE,
  useNewBlueprintPage,
} from '@/pages/new-blueprint/use-new-blueprint-page';

function Breadcrumbs({ owner, repo }: { owner: string; repo: string }) {
  return (
    <div className="flex items-center gap-2 text-[0.9375rem]">
      <span className="text-muted-foreground">/</span>
      <Link
        to={`/repo/${owner}/${repo}`}
        className="text-muted-foreground transition-colors hover:text-primary"
      >
        {repo}
      </Link>
      <span className="text-muted-foreground">/</span>
      <span className="font-semibold text-foreground">
        {NEW_BLUEPRINT_PAGE_TITLE}
      </span>
    </div>
  );
}

/** New-workspace route shell; the workflow and form rendering live separately. */
export default function NewBlueprint() {
  const { owner, repo, form } = useNewBlueprintPage();
  return (
    <div className="page-bg flex h-screen flex-col overflow-y-auto">
      <AppHeader breadcrumbs={<Breadcrumbs owner={owner} repo={repo} />} />
      <main className="flex w-full flex-1 flex-col px-6 py-6">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <NewBlueprintForm form={form} />
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
