import { Link } from 'react-router-dom';
import { FolderOpen, MessagesSquare, ScanLine, Wrench } from 'lucide-react';
import { BlueprintIcon, GitIcon, WorkspaceIcon } from '@/components/icons/ProjectIcons';
import GuidePageLayout from '@/components/guide/GuidePageLayout';
import { guideTopics } from '@/components/guide/topics';

const topicIcons = [FolderOpen, WorkspaceIcon, BlueprintIcon, MessagesSquare, GitIcon, ScanLine, Wrench];

export default function Guide() {
  return (
    <GuidePageLayout slug="">
      <div className="mb-9">
        <h2 className="text-[2rem] font-semibold leading-tight tracking-[-0.035em] text-foreground">Overview</h2>
        <p className="mt-4 max-w-[600px] text-[0.9375rem] leading-7 text-[var(--text-body)]">Fuse is a desktop app that connects a LaTeX blueprint, a coding agent, and Lean in one workspace.</p>
      </div>

      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {guideTopics.map((topic, index) => {
          const Icon = topicIcons[index];
          return (
            <li key={topic.slug}>
              <Link to={`/guide/${topic.slug}`} className="group flex h-full gap-3 rounded-[10px] bg-muted/45 px-5 py-5 text-foreground no-underline transition-colors hover:bg-muted/80 dark:bg-muted dark:hover:bg-[color-mix(in_srgb,var(--muted),white_5%)] focus-visible:outline-2 focus-visible:outline-muted-foreground">
                <Icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-[0.8125rem] font-semibold">{topic.label}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{topic.description}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </GuidePageLayout>
  );
}
