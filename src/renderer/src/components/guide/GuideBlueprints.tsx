import { Chapter, Code, GuideSection, Note, Sample } from './GuideElements';
import { useRef, useState, type PointerEvent } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { renderMath } from '@/lib/render-math';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { parseLatex } from '@/features/blueprint/hooks/latex-parser';
import 'katex/dist/katex.min.css';

const blueprint = String.raw`\begin{definition}\label{def:twice}
\lean{twice}
\leanok
For a natural number $n$, define $\operatorname{twice}(n)=n+n$.
\end{definition}

\begin{lemma}\label{lem:twice-zero}
\lean{twice_zero}
\leanok
\uses{def:twice}
We have $\operatorname{twice}(0)=0$.
\end{lemma}
\begin{proof}
\leanok
Unfold the definition and compute.
\end{proof}`;

const exampleStatuses = Object.fromEntries(parseLatex(blueprint).entries.map(entry => [entry.label, { kind: entry.kind, status: entry.status }]));
const renderedBlueprint = renderMath(blueprint, undefined, exampleStatuses);

export default function GuideBlueprints() {
  const [split, setSplit] = useState(50);
  const comparison = useRef<HTMLDivElement>(null);
  function moveDivider(event: PointerEvent<HTMLDivElement>) {
    const bounds = comparison.current?.getBoundingClientRect();
    if (bounds?.width) setSplit(Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)));
  }
  return <Chapter title="Blueprints" intro="A blueprint is a LaTeX document containing your mathematical argument and links to Lean. Each named definition, lemma, or theorem is a declaration; its dependencies connect it to other declarations.">
    <GuideSection title="One definition. One lemma.">
      <p>This example shows a completed definition and lemma. Drag the divider to compare the rendered document with its LaTeX source. The matching Lean code is below.</p>
      <Card role="region" aria-label="Example blueprint" className="gap-0 rounded-[10px] border border-[var(--code-border)] bg-[var(--code-bg)] py-0 ring-0">
        <CardContent className="overflow-hidden p-0">
          <div ref={comparison} className="relative isolate grid">
            <div className="col-start-1 row-start-1 min-w-0 bg-[var(--code-bg)] px-5 py-5 sm:px-6" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} inert={split === 0} aria-hidden={split === 0}>
              <div className="doc-body" dangerouslySetInnerHTML={{ __html: renderedBlueprint }} />
            </div>
            <div className="col-start-1 row-start-1 min-w-0 bg-[var(--code-bg)]" style={{ clipPath: `inset(0 0 0 ${split}%)` }} inert={split === 100} aria-hidden={split === 100}>
              <Sample embedded language="latex" label="Blueprint · LaTeX" source={blueprint} />
            </div>
            <div role="slider" tabIndex={0} aria-label="Blueprint preview reveal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split)} aria-valuetext={`${Math.round(split)}% preview`} aria-orientation="horizontal"
              className="group absolute inset-y-0 z-10 w-10 -translate-x-1/2 cursor-col-resize touch-none select-none outline-none"
              style={{ left: `${split}%` }}
              onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); moveDivider(event); }}
              onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveDivider(event); }}
              onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
              onKeyDown={event => {
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : event.key === 'ArrowLeft' ? split - 5 : event.key === 'ArrowRight' ? split + 5 : null;
                if (next !== null) { event.preventDefault(); setSplit(Math.max(0, Math.min(100, next))); }
              }}>
              <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-border group-hover:bg-muted-foreground group-focus-visible:bg-foreground" />
              <span className="absolute left-1/2 top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm group-focus-visible:ring-2 group-focus-visible:ring-ring"><ArrowLeftRight size={18} aria-hidden="true" /></span>
            </div>
          </div>
        </CardContent>
      </Card>
    </GuideSection>
    <GuideSection title="Blueprint markers">
      <dl className="divide-y divide-border border-y border-border">
        {[
          ['\\label{lem:twice-zero}', 'A stable identity inside the blueprint. Other declarations can refer to this label.'],
          ['\\lean{twice_zero}', 'The corresponding Lean declaration name. Include its namespace when needed.'],
          ['\\uses{def:twice}', 'An explicit dependency on the definition above. These references connect the graph.'],
          ['\\leanok', 'Records completion of the statement or proof containing it. Place it inside the relevant declaration or proof environment.'],
        ].map(([tag, detail]) => <div key={tag} className="grid gap-2 py-4 sm:grid-cols-[210px_1fr]"><dt><Code>{tag}</Code></dt><dd>{detail}</dd></div>)}
      </dl>
      <p>For a lemma or theorem, a statement-level <Code>\leanok</Code> records that the statement is formalized. A <Code>\leanok</Code> inside its proof records proof completion. In this example both are present, so the lemma displays <strong>Proved</strong>. The definition displays <strong>Formalized</strong>, because it has no separate proof obligation. The split matters: a lemma can be correctly stated in Lean long before anyone proves it.</p>
    </GuideSection>
    <GuideSection title="Status badges">
      <dl className="space-y-3">
        <div><dt className="font-semibold text-foreground">Unformalized</dt><dd>The declaration hasn’t been marked as formalized.</dd></div>
        <div><dt className="font-semibold text-foreground">Formalized</dt><dd>The statement is marked as formalized. A lemma or theorem still needs its proof; a definition without a proof obligation is complete at this stage.</dd></div>
        <div><dt className="font-semibold text-foreground">Proved</dt><dd>The proof of a lemma, theorem, or other proof-required declaration is marked complete.</dd></div>
      </dl>
      <p><strong>Badges come from the LaTeX markers.</strong> Keep the markers in step with the Lean code, and refresh the blueprint after correcting them. <Link to="/guide/capabilities" className="underline underline-offset-4">What to trust</Link> explains how that differs from checking a proof.</p>
    </GuideSection>
    <GuideSection title="What the Lean side can look like">
      <p><Code>Nat</Code> is Lean’s type of natural numbers. Here <Code>rfl</Code> closes the proof by checking that both sides reduce to the same expression. The example needs no Mathlib imports, although a project created through Setup still includes Mathlib as a dependency.</p>
      <Sample label="Lean · a complete small proof" source={'def twice (n : Nat) : Nat := n + n\n\ntheorem twice_zero : twice 0 = 0 := by\n  rfl'} />
    </GuideSection>
    <Note title="Status is a signpost, not the whole review">Badges reflect recorded progress, not an independent proof check. Read <Link to="/guide/capabilities" className="underline underline-offset-4">What to trust</Link> before relying on a badge or a successful build.</Note>
    <GuideSection title="Writing a larger argument">
      <p>Write down the types and assumptions the translation must preserve. If your proof divides by a real number <Code>x</Code>, for example, say why <Code>x ≠ 0</Code>. Give intermediate lemmas their own labels, connect them with <Code>\uses</Code>, and include the proof idea. Smaller named results make it easier to spot where a translation went off course.</p>
    </GuideSection>
  </Chapter>;
}
