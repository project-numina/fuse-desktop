import { Chapter, Code, GuideSection, Note } from './GuideElements';

export default function GuideCapabilities() {
  return <Chapter title="What to trust" intro="Lean can check a proof of a theorem you didn’t mean to ask for. It checks the proof against the formal statement; checking that the statement matches your mathematics is your part of the work.">
    <GuideSection title="Check the statement">
      <p>Open the declaration in the <strong>Lean</strong> tab and compare its types, hypotheses, quantifiers, and conclusion with your blueprint. A small change of type can make a hard-looking claim trivial:</p>
      <p>“Every natural number is at least zero” is true.<br />“Every real number is at least zero” is false: take −1.</p>
      <p>A proof of the first tells you nothing about the second. If the translation is wrong, ask for the statement to be corrected before continuing with its proof. We recommend checking the declaration itself, even when the agent’s explanation sounds convincing.</p>
    </GuideSection>
    <Note title="A successful build can still contain unfinished proofs">Lean accepts <Code>sorry</Code> as a placeholder for a missing proof, usually with a warning. Before trusting a green build, search the relevant Lean files for <Code>sorry</Code> and read the build warnings. Check any extra assumptions too: a proof is only as useful as the statement and assumptions it relies on.</Note>
    <GuideSection title="Where badges come from">
      <p>Fuse reads the LaTeX markers into a status for each declaration. Agents update status by changing those markers too. If there’s no stored status, the renderer infers a badge from <Code>\lean</Code> and <Code>\leanok</Code>. Refreshing the blueprint re-reads the markers; running a Lean build doesn’t set them. That’s why a stale marker can say <strong>Proved</strong> even when the proof still needs work.</p>
    </GuideSection>
    <GuideSection title="Check changes and errors">
      <p>Read the transcript alongside the Git diff, especially after a failed tool call: some edits may already have landed. If the build fails, start with its error output rather than the agent’s summary of what it hoped to finish.</p>
    </GuideSection>
  </Chapter>;
}
