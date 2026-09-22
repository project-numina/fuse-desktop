import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { CodeEditor, type EditorLanguage } from '@/components/editor/CodeEditor';
import { LatexEditor } from '@/components/editor/LatexEditor';
import { Button } from '@/components/ui/button';

export function Chapter({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return <div className="guide-chapter">
    <header className="mb-9">
      <h2 className="text-[2rem] font-semibold leading-tight tracking-[-0.035em] text-foreground">{title}</h2>
      <p className="mt-4 max-w-[600px] text-[0.9375rem] leading-7 text-[var(--text-body)]">{intro}</p>
    </header>
    <div className="flex flex-col gap-9 text-sm text-[var(--text-body)] [&_p]:leading-7 [&_strong]:font-semibold [&_strong]:text-foreground">{children}</div>
  </div>;
}

export function GuideSection({ title, children }: { title: string; children: ReactNode }) {
  return <section><h3 className="mb-3 text-base font-semibold text-foreground">{title}</h3><div className="space-y-3">{children}</div></section>;
}

export function Note({ title, children }: { title: string; children: ReactNode }) {
  return <aside className="rounded-2xl bg-primary/[0.055] p-5 dark:bg-[color-mix(in_srgb,var(--numina-info)_9%,transparent)]">
    <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
    <div className="text-sm leading-6 text-[var(--text-body)]">{children}</div>
  </aside>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-[3px] bg-muted px-1 py-0.5 font-mono text-[0.75rem]">{children}</code>;
}

export function GuideScreenshot({ src, alt, children }: { src: string; alt: string; children: ReactNode }) {
  return <figure className="space-y-2">
    <a href={src} target="_blank" rel="noreferrer" aria-label={`Open full-size screenshot: ${alt}`} className="block overflow-hidden rounded-[10px] border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-muted-foreground">
      <img src={src} alt={alt} width={1280} height={780} loading="lazy" className="block h-auto w-full" />
    </a>
    <figcaption className="text-xs leading-5 text-muted-foreground">{children} Select the image to view it full size.</figcaption>
  </figure>;
}

export function Sample({ label, source, prose = false, language = 'lean', embedded = false }: { label: string; source: string; prose?: boolean; language?: EditorLanguage; embedded?: boolean }) {
  const [status, setStatus] = useState('Copy');
  async function copy() {
    try { await navigator.clipboard.writeText(source); setStatus('Copied'); }
    catch { setStatus('Select text to copy'); }
  }
  const copyButton = <Button variant="ghost" size="xs" onClick={() => void copy()} aria-label={`Copy ${label}`}>{status === 'Copied' ? <Check /> : <Copy />}<span aria-live="polite">{status}</span></Button>;
  if (embedded && language === 'latex') return <LatexEditor embedded headerActions={copyButton} value={source} fileName="blueprint.tex" readonly latexLinting={false} lineWrapping fillHeight />;
  if (!prose) return <div>
    <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{label}</span>{copyButton}</div>
    {language === 'latex' ? <LatexEditor value={source} fileName="blueprint.tex" readonly latexLinting={false} lineWrapping fillHeight={false} pageScroll /> : <CodeEditor value={source} language="lean" readonly lineWrapping fillHeight={false} pageScroll className="rounded-[var(--radius-md)] border border-[var(--code-border)] bg-[var(--code-bg)]" />}
  </div>;
  return <div className="overflow-hidden rounded-[10px] border border-border bg-card">
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-[0.6875rem] text-muted-foreground">
      <span>{label}</span>{copyButton}
    </div>
    <p className="m-0 whitespace-pre-wrap break-words p-5 text-sm leading-7 text-foreground">{source}</p>
  </div>;
}

export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return <ol className="m-0 list-none space-y-6 p-0">{items.map((item, index) => <li key={item.title} className="flex gap-4">
    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[0.6875rem] text-muted-foreground">{index + 1}</span>
    <div className="min-w-0"><h3 className="mb-1 text-sm font-semibold text-foreground">{item.title}</h3><div className="text-sm leading-7">{item.body}</div></div>
  </li>)}</ol>;
}
