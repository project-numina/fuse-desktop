/**
 * Shared CodeMirror 6 theme used across all editor instances.
 * Centralizes visual styling so it stays consistent and easy to update.
 */

import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { latexStructureCommandTag, latexStructureNameTag } from '@/lib/latex-language';

const latexHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syntax-latex-command)' },
  { tag: t.heading, color: 'var(--syntax-latex-command)', fontWeight: 'bold' },
  { tag: t.strong, color: 'var(--syntax-latex-command)', fontWeight: 'bold' },
  { tag: t.emphasis, color: 'var(--syntax-latex-command)', fontStyle: 'italic' },
  { tag: t.monospace, color: 'var(--syntax-latex-command)' },
  { tag: latexStructureCommandTag, color: 'var(--syntax-latex-structure-command)' },
  { tag: latexStructureNameTag, color: 'var(--syntax-latex-structure-name)' },
  { tag: t.definitionKeyword, color: 'var(--syntax-latex-keyword)' },
  { tag: t.className, color: 'var(--syntax-latex-keyword)' },
  { tag: t.labelName, color: 'var(--syntax-latex-function)' },
  { tag: t.quote, color: 'var(--syntax-latex-function)' },
  { tag: t.processingInstruction, color: 'var(--syntax-latex-equation)' },
  { tag: t.comment, color: 'var(--syntax-latex-comment)' },
  { tag: t.string, color: 'var(--syntax-string)' },
  { tag: t.number, color: 'var(--syntax-number)' },
  { tag: t.operator, color: 'var(--syntax-latex-punctuation)' },
  { tag: t.bracket, color: 'var(--syntax-latex-punctuation)' },
  { tag: t.invalid, color: 'var(--build-error)' },
]);

export const latexHighlighting = syntaxHighlighting(latexHighlightStyle);

const leanHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syntax-keyword)' },
  { tag: t.controlKeyword, color: 'var(--syntax-keyword)' },
  { tag: t.definitionKeyword, color: 'var(--syntax-keyword)' },
  { tag: t.moduleKeyword, color: 'var(--syntax-keyword)' },
  { tag: t.operatorKeyword, color: 'var(--syntax-keyword)' },
  { tag: t.standard(t.variableName), color: 'var(--syntax-built-in)' },
  { tag: t.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: t.lineComment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: t.blockComment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--syntax-string)' },
  { tag: t.number, color: 'var(--syntax-number)' },
  { tag: t.variableName, color: 'var(--text-primary)' },
  { tag: t.operator, color: 'var(--syntax-symbol)' },
  { tag: t.meta, color: 'var(--syntax-attr)' },
]);

export const leanHighlighting = syntaxHighlighting(leanHighlightStyle);

const latexDisplayDelimiterMark = Decoration.mark({
  attributes: {
    style: 'color: var(--syntax-latex-equation) !important;',
  },
});

function buildLatexStructureDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  const displayDelimiterPattern = /\\\[|\\\]/g;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    let match;

    while ((match = displayDelimiterPattern.exec(text)) !== null) {
      const delimiterStart = from + match.index;
      const delimiterEnd = delimiterStart + match[0].length;
      builder.add(delimiterStart, delimiterEnd, latexDisplayDelimiterMark);
    }
  }

  return builder.finish();
}

export const latexStructuralHighlighting = ViewPlugin.fromClass(class {
  decorations;

  constructor(view: EditorView) {
    this.decorations = buildLatexStructureDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildLatexStructureDecorations(update.view);
    }
  }
}, {
  decorations: value => value.decorations,
});

export const editorTheme = EditorView.theme({
  '&': {
    fontSize: 'var(--text-xs)',
    fontFamily: 'var(--numina-font-mono)',
  },
  '.cm-content': {
    fontFamily: 'var(--numina-font-mono)',
    fontSize: 'var(--text-xs)',
    lineHeight: '1.5',
  },
  '.cm-gutters': {
    background: 'var(--code-bg)',
    color: 'var(--code-line-number)',
    border: 'none',
    borderRight: '1px solid var(--code-border)',
    fontFamily: 'var(--numina-font-mono)',
    fontSize: 'var(--text-xs)',
    lineHeight: '1.5',
  },
  '.cm-activeLineGutter': {
    background: 'var(--code-border)',
  },
  '.cm-activeLine': {
    background: 'var(--code-header-bg)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--text-primary)',
  },
  '.cm-selectionBackground': {
    background: 'var(--editor-selection-bg) !important',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },

  // CodeMirror's default tooltip styling is hardcoded to a light background,
  // which renders as near-white on near-white text in dark mode. Route the
  // popovers used by the lint extension and language-service hovers through
  // the same tokens the rest of the app uses so they follow the active theme.
  '.cm-tooltip': {
    background: 'var(--numina-card-bg)',
    color: 'var(--text-primary)',
    border: '1px solid var(--numina-border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--numina-shadow)',
    fontFamily: 'var(--numina-font-sans)',
    fontSize: 'var(--text-xs)',
  },
  '.cm-tooltip.cm-tooltip-hover, .cm-tooltip.cm-tooltip-lint': {
    maxWidth: '32rem',
    padding: '0',
  },
  '.cm-tooltip-section': {
    padding: 'var(--space-2) var(--space-3)',
    borderBottom: '1px solid var(--numina-border-light)',
  },
  '.cm-tooltip-section:last-child': {
    borderBottom: 'none',
  },
  // Lean LSP hover card. The chrome (border, background, radius, shadow) comes
  // from `.cm-tooltip` above; only the inner layout belongs here, or the card
  // would carry a second border.
  '.lean-hover-tooltip': {
    padding: 'var(--space-2) var(--space-3)',
    maxHeight: '24rem',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  '.lean-hover-tooltip.lean-hover-error': {
    color: 'var(--numina-error)',
  },
  // Lean signatures are long and pre-formatted; wrap them instead of forcing
  // the whole card to scroll sideways.
  '.lean-hover-body pre': {
    margin: '0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  '.lean-hover-body p:first-child': {
    marginTop: '0',
  },
  '.lean-hover-body p:last-child': {
    marginBottom: '0',
  },
  '.cm-tooltip-arrow:before': {
    borderTopColor: 'var(--numina-border)',
    borderBottomColor: 'var(--numina-border)',
  },
  '.cm-tooltip-arrow:after': {
    borderTopColor: 'var(--numina-card-bg)',
    borderBottomColor: 'var(--numina-card-bg)',
  },
  '.cm-diagnostic': {
    padding: 'var(--space-2) var(--space-3)',
    borderLeft: '3px solid transparent',
    color: 'var(--text-primary)',
  },
  '.cm-diagnostic-error': {
    borderLeftColor: 'var(--build-error)',
  },
  '.cm-diagnostic-warning': {
    borderLeftColor: 'var(--build-warning)',
  },
  '.cm-diagnostic-info': {
    borderLeftColor: 'var(--numina-accent)',
  },
  '.cm-diagnosticText': {
    color: 'var(--text-body)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--numina-font-mono)',
    fontSize: 'var(--text-xs)',
    maxHeight: '14rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '0.125rem var(--space-2)',
    color: 'var(--text-primary)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--numina-surface-sunken)',
    color: 'var(--numina-accent)',
  },
  '.cm-completionLabel': {
    color: 'inherit',
  },
  '.cm-completionDetail': {
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
});
