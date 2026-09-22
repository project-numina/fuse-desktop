import GuidePageLayout from '@/components/guide/GuidePageLayout';
import GuidePullRequests from '@/components/guide/GuidePullRequests';

export default function GuidePullRequestsPage() {
  return (
    <GuidePageLayout slug="pull-requests">
      <GuidePullRequests />
    </GuidePageLayout>
  );
}
