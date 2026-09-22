import AppFooter from '@/components/layout/AppFooter';
import AppHeader from '@/components/layout/AppHeader';
import NewProjectForm from '@/pages/new-project/NewProjectForm';
import { useNewProjectWorkflow } from '@/pages/new-project/use-new-project-workflow';

const breadcrumbs = (
  <div className="flex items-center gap-2 text-[0.9375rem]">
    <span className="text-muted-foreground">/</span>
    <span className="font-semibold text-foreground">New Project</span>
  </div>
);

/** Lean-project setup wizard for registered and newly chosen local folders. */
export default function NewProject() {
  const workflow = useNewProjectWorkflow();
  return (
    <div className="page-bg flex h-screen flex-col overflow-y-auto">
      <AppHeader breadcrumbs={breadcrumbs} />
      <main className="flex w-full flex-1 flex-col px-6 py-6">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <NewProjectForm workflow={workflow} />
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
