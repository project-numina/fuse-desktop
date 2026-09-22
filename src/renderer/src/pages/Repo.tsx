import AppPage from '@/components/layout/AppPage';
import RepoView from '@/pages/repo/RepoView';
import { useRepoPage } from '@/pages/repo/use-repo-page';

/** Repository workspace index with deferred, undoable deletion. */
export default function Repo() {
  const model = useRepoPage();
  return (
    <AppPage>
      <RepoView model={model} />
    </AppPage>
  );
}
