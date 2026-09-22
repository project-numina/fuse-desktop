import { Chapter, GuideSection, Note } from './GuideElements';

export default function GuidePullRequests() {
  return <Chapter title="Changes" intro="Use the Changes tab to review changes and commit history. You decide when to commit and push.">
    <GuideSection title="Review changes">
      <p>Check the diff before committing. Your edits and the agent’s share the same working folder, so they may appear together.</p>
      <p>Ask Claude Code or Codex to commit the changes you want, or use your usual Git tools. The agent follows its configured permissions and sandbox.</p>
    </GuideSection>
    <Note title="You control commits">Fuse leaves agent edits, blueprint saves, and setup files uncommitted. Finishing a turn doesn’t trigger a commit or push. The Changes tab is read-only. Ask the agent to commit or push, or use your usual Git tools.</Note>
    <GuideSection title="Branches and undoing changes">
      <p>Choose your branch before starting an agent. Fuse works directly in the checked-out folder, so keep that branch checked out while work is running.</p>
      <p>Review the diff before discarding anything. For a commit already shared, a revert creates an undoing commit without rewriting shared history.</p>
      <p>In a folder without Git, you can still edit files. Change diffs and commit history need a Git repository.</p>
    </GuideSection>
  </Chapter>;
}
