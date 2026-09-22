import { Link } from 'react-router-dom';
import { DisclosureRow } from '@/components/ui/disclosure-row';
import { Chapter, Note } from './GuideElements';

const items = [
  { group: 'Opening & setup', question: "My folder doesn't show up", answer: 'Use Open folder on the dashboard, or drop the folder onto the window, to add it to the list. If you moved it, open its new location.' },
  { group: 'Opening & setup', question: "The agent can't find claude or codex", answer: 'First try running the CLI in a terminal and signing in there. Then open Settings → Agents and use Check again. If Fuse still can’t detect it, enter the executable’s path.', link: '/account', linkLabel: 'Settings → Agents' },
  { group: 'Opening & setup', question: "My PDF didn't import", answer: 'Check the size and whether the file opens without a password. Uploads are limited to 20 MB and need a readable, unencrypted file; export a smaller or unlocked copy if necessary. A scan can import as a PDF, but you’ll need to transcribe any text you want to quote.' },
  { group: 'Lean & builds', question: 'The first build is taking a long time', answer: 'It may be downloading or compiling Mathlib. Check the output: progress is a reason to wait, while a reported failure needs attention. The time depends on your machine, connection, and which dependencies are already cached.' },
  { group: 'Lean & builds', question: 'The build fails', answer: 'Start with the first error in the build output; later ones may just follow from it. You can also run lake build in a terminal from the selected Lean project directory. For download failures, check your connection and elan installation. For version or import errors, compare lean-toolchain with the dependencies in the lakefile. Fix that first error, then rebuild.' },
  { group: 'Lean & builds', question: 'The Infoview is blank or slow', answer: 'The Infoview follows your cursor. Open a file in the Lean tab and click inside a declaration. If it stays blank, check the build and language-server diagnostics. Lean may still be processing the file, especially after a dependency change.' },
  { group: 'Agent & changes', question: 'The agent stopped before it finished', answer: 'Look at the last response and tool output: the agent may have hit an error or usage limit, or be waiting for you. Check the Changes tab for edits it already made before continuing. In your next message, name the unfinished declaration and what remains to do.' },
  { group: 'Agent & changes', question: "My changes aren't committed yet", link: '/guide/pull-requests', linkLabel: 'Changes', answer: 'Fuse leaves changes uncommitted. Review the diff in the Changes tab, then ask your agent to commit or use your Git tools. If an explicit commit failed, check the reported error.' },
  { group: 'Agent & changes', question: "I can't start a new chat", answer: 'Desktop has no fixed session cap, so check the reported error and whether the selected agent CLI is detected and signed in. If New chat is missing entirely, the workspace may be merged and read-only; open a writable workspace to continue.', link: '/account', linkLabel: 'Settings → Agents' },
  { group: 'Lean & builds', question: 'Setup created a project, but Mathlib will not build', answer: 'Mathlib needs a compatible Lean version. Check the first error to see whether the problem is a download or a toolchain mismatch, then compare the Mathlib revision with lean-toolchain. Match Mathlib in Setup is the easiest way to start with a compatible pair.' },
  { group: 'Agent & changes', question: 'The statement is not what I meant', answer: 'Open the declaration in the Lean tab and compare its hypotheses, types, and conclusion with your blueprint. Ask for the statement to be corrected before continuing with the proof.' },
  { group: 'Agent & changes', question: 'The agent pushed something I didn’t want', answer: 'Use your Git tools to check the commit. If it’s already shared, a revert gives you an undoing commit while preserving history. Review the agent’s transcript and permissions before continuing. Ask it to wait for your approval before publishing future changes.', link: '/guide/pull-requests', linkLabel: 'Commit and push behavior' },
  { group: 'Lean & builds', question: 'The badge says Proved, but the file has sorry', answer: 'The marker and the proof are out of step. Open the declaration in the Lean tab, correct the LaTeX markers to match its actual progress, and refresh the blueprint.', link: '/guide/blueprints', linkLabel: 'Blueprints' },
];

export default function GuideTroubleshooting() {
  return <Chapter title="Troubleshooting" intro="Find the symptom below. Keep the error output nearby. It’s usually more useful than retrying the same action.">
    {['Opening & setup', 'Lean & builds', 'Agent & changes'].map(group => {
      const matches = items.filter(item => item.group === group);
      return matches.length > 0 && <section key={group}><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</h3><div className="border-t border-border">{matches.map(item => <DisclosureRow key={item.question} title={item.question}>
        <p>{item.answer}{item.link && <> See <Link to={item.link} className="underline underline-offset-4">{item.linkLabel}</Link>.</>}</p>
      </DisclosureRow>)}</div></section>;
    })}
    <Note title="Before reporting an issue">Tell us what you were doing, what happened, and the exact error. Include the relevant tool or build output, but scrub API keys and anything private from the logs before you send them.</Note>
  </Chapter>;
}
