import { Link } from 'react-router-dom';
import { Chapter, GuideScreenshot, GuideSection, Note } from './GuideElements';

const views = [
  ['Overview', 'The rendered argument, with a status badge beside each declaration.'],
  ['Blueprint', 'Edit the LaTeX statements and proof sketches. Changes save automatically.'],
  ['Graph', 'The dependency picture built from your \\uses references. Useful for spotting a lemma you forgot to connect.'],
  ['Sources', 'Read source documents, preview PDFs, and attach selected lines from available text sources to chat.'],
  ['Lean', 'Open Lean files. The Infoview shows the proof goal (the claim still to prove) and diagnostic messages at your cursor.'],
  ['History', 'Claude Code and Codex chats saved for this folder, alongside existing Fuse conversations. Return here to continue a chat with its original provider.'],
  ['Changes', 'File changes and commit history, including edits made outside Fuse.'],
  ['Settings', 'Change this workspace’s agent, model, permission and sandbox modes.'],
];

export default function GuideWorkspace() {
  return <Chapter title="Workspace" intro="Open a blueprint to enter its workspace. Use the view controls to switch between the document, Lean files, and Changes; the chat panel is where you work with the agent.">
    <GuideScreenshot src="/guide/workspace.png" alt="Fuse workspace with the left-hand view tabs and the Active sessions button in the top-right header labeled.">The workspace with sample data. The view tabs are on the left; Active sessions is in the header.</GuideScreenshot>
    <dl className="divide-y divide-border border-y border-border">
      {views.map(([name, description]) => <div key={name} className="grid gap-2 py-4 sm:grid-cols-[120px_1fr] sm:gap-5">
        <dt className="font-semibold text-foreground">{name}</dt>
        <dd className="leading-6">{description}</dd>
      </div>)}
    </dl>
    <GuideSection title="Sources and attachments">
      <p>A blueprint is a <code>.tex</code> file selected or created inside the workspace. Reference sources are separate: the source-upload dialog additionally accepts Markdown (<code>.md</code> or <code>.markdown</code>) and <code>.pdf</code> files.</p>
      <p>Open documents in <strong>Sources</strong>. See <Link to="/guide/agents" className="underline underline-offset-4">Agents</Link> for attaching text selections and the limitations of PDF attachments.</p>
    </GuideSection>
    <GuideSection title="Running work">
      <p id="active-sessions" className="scroll-mt-24">The clock-style <strong>Active sessions</strong> button in the top-right header opens the sessions page. Use it to return to or stop a running session. See <Link to="/guide/agents" className="underline underline-offset-4">Agents</Link> for chat and permission controls.</p>
    </GuideSection>
    <Note title="Edits use your local files">Fuse, the agent, and your editor all use the same files on disk. Editing the same file at the same time risks overwriting each other’s changes, so wait for the agent to finish before making your own edits.</Note>
  </Chapter>;
}
