import { Link } from 'react-router-dom';
import { Chapter, Code, GuideSection, Note, Steps } from './GuideElements';

export default function GuideSetup() {
  return <Chapter title="Setup" intro="Start with a folder on your computer. You can use an existing Lean project or let Fuse set one up inside it.">
    <GuideSection title="Before you start">
      <p>You’ll need Lean and elan installed. Follow the <a href="https://leanprover-community.github.io/get_started.html" target="_blank" rel="noreferrer" className="underline underline-offset-4">Lean installation instructions</a>; Fuse uses the version named in your project’s <Code>lean-toolchain</Code> file.</p>
      <p>Install Claude Code or Codex and sign in from a terminal. Fuse reuses that CLI login, so you won’t need a separate Fuse account. <Link to="/account" className="underline underline-offset-4">Settings</Link> → <strong>Agents</strong> shows whether the executable has been detected. You’ll still need working access through your chosen provider.</p>
      <p>For commits and syncing, use a Git repository. You can open a folder without Git if you only need to edit files.</p>
    </GuideSection>
    <Note title="If you’re new to Lean">Lean checks formal statements and proofs. Elan installs the required Lean version; Lake builds the project and manages its dependencies; Mathlib is the community mathematics library. Keep the <a href="https://lean-lang.org/learn/" target="_blank" rel="noreferrer" className="underline underline-offset-4">Lean learning resources</a> handy for syntax and proof-writing. We’ll explain blueprint conventions here as you need them.</Note>
    <Steps items={[
      { title: 'Open a folder', body: <>Choose <strong>Open folder</strong> on the dashboard or drop a folder onto the window. This points Fuse at the folder where it already lives; nothing gets copied.</> },
      { title: 'Create a workspace', body: <>Click the folder’s name in the dashboard’s <strong>Repositories</strong> list, then choose <strong>New workspace</strong>. Give it a title, select a Lean project, and choose <strong>Create workspace</strong>. If there’s no Lean project yet, use the setup option below.</> },
      { title: 'Set up Lean if you need it', body: <>Choose <strong>Set up Lean project</strong>. <strong>Match Mathlib (recommended)</strong> uses a Lean version compatible with Mathlib, so you start with a matching toolchain and library. You can also choose a specific Lean release. Setup writes the starter files, <Code>lakefile.toml</Code>, and <Code>lean-toolchain</Code>, with a Mathlib dependency. The new files stay uncommitted for you to review.</> },
      { title: 'Choose or create a blueprint', body: <>In the workspace, choose <strong>Select an existing blueprint</strong> to use a <Code>.tex</Code> file from the repository, or <strong>Create a new blueprint</strong>. Edit it in the <strong>Blueprint</strong> tab; the example in <Link to="/guide/blueprints" className="underline underline-offset-4">Blueprints</Link> gives you a small result to try. Reference documents are separate: use <strong>Add</strong> in <strong>Sources</strong> to upload LaTeX, Markdown, or PDF files.</> },
      { title: 'Run a build when you’re ready', body: <>Opening a workspace or starting a chat won’t build the project. Run a build from the <strong>Lean</strong> tab, ask the agent to build, or run <Code>lake build</Code> in the project folder. The first build may download dependencies and take substantial disk space. A project created through Setup includes Mathlib even if your first file doesn’t import it. If a build fails, check <Link to="/guide/troubleshooting" className="underline underline-offset-4">Troubleshooting</Link>.</> },
    ]} />
    <Note title="Before starting an agent">Choose the branch you want to work on, because Fuse and your agent edit that folder directly. Review changes in the <Link to="/guide/pull-requests" className="underline underline-offset-4">Changes</Link> tab, then ask the agent to commit or push when you’re ready. Fuse leaves changes uncommitted on its own.</Note>
    <GuideSection title="Files and network access">
      <p>Your working files live in the folder you opened. New blueprint files go under <Code>numina/blueprints/</Code>; an existing blueprint can keep its original path.</p>
      <p>Here’s where network access comes in:</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Agent prompts and project context can go to the provider through its CLI.</li>
        <li>Builds can download project dependencies.</li>
        <li>Git can push commits to the branch’s configured upstream.</li>
      </ul>
    </GuideSection>
  </Chapter>;
}
