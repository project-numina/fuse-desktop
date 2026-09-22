/**
 * Local LaTeX language wrapper for CodeMirror.
 * Keeps the upstream parser behavior, but remaps a few tokens so the
 * app can control visual semantics more precisely.
 */

import { LRLanguage, LanguageSupport, foldInside, foldNodeProp, foldService, indentNodeProp, bracketMatching } from '@codemirror/language';
import { Tag, styleTags, tags as t } from '@lezer/highlight';
import { closeBrackets, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { linter } from '@codemirror/lint';
import { keymap } from '@codemirror/view';
import { parser, latexCompletionSource, autoCloseTags, latexLinter } from 'codemirror-lang-latex';

const latexBracketMatching = bracketMatching({
  brackets: '()[]{}',
});

export const latexStructureCommandTag = Tag.define(t.atom);
export const latexStructureNameTag = Tag.define(t.namespace);

interface FoldDoc {
  lineAt: (pos: number) => { text: string, number: number, to: number };
  line: (lineNo: number) => { text: string, to: number };
  lines: number;
}

function commentFoldRanges(
  state: { doc: FoldDoc },
  lineStart: number,
) {
  const doc = state.doc;
  const startLine = doc.lineAt(lineStart);

  if (startLine.text.startsWith('% {')) {
    for (let lineNo = startLine.number + 1; lineNo <= doc.lines; lineNo += 1) {
      const line = doc.line(lineNo);
      if (line.text.trim() === '% }') {
        return {
          from: startLine.to,
          to: line.to - 1,
        };
      }
    }
  }

  return null;
}

export const latexLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Environment: context => context.baseIndent + context.unit,
        KnownEnvironment: context => context.baseIndent + context.unit,
        Group: context => context.baseIndent + context.unit,
        BeginEnv: context => context.baseIndent + context.unit,
        'Content TextArgument LongArg': context => context.baseIndent + context.unit,
      }),
      foldNodeProp.add({
        Environment: foldInside,
        KnownEnvironment: foldInside,
        Group: foldInside,
        DocumentEnvironment: foldInside,
        TabularEnvironment: foldInside,
        EquationEnvironment: foldInside,
        EquationArrayEnvironment: foldInside,
        VerbatimEnvironment: foldInside,
        TikzPictureEnvironment: foldInside,
        FigureEnvironment: foldInside,
        ListEnvironment: foldInside,
        TableEnvironment: foldInside,
        Book: foldInside,
        Part: foldInside,
        Chapter: foldInside,
        Section: foldInside,
        SubSection: foldInside,
        SubSubSection: foldInside,
        Paragraph: foldInside,
        SubParagraph: foldInside,
      }),
      styleTags({
        CtrlSeq: t.keyword,
        CtrlSym: t.operator,
        Csname: t.keyword,
        Dollar: t.processingInstruction,
        MathSpecialChar: t.operator,
        MathChar: t.variableName,
        MathOpening: t.bracket,
        MathClosing: t.bracket,
        EnvName: latexStructureNameTag,
        DocumentEnvName: latexStructureNameTag,
        TabularEnvName: latexStructureNameTag,
        EquationEnvName: latexStructureNameTag,
        EquationArrayEnvName: latexStructureNameTag,
        VerbatimEnvName: latexStructureNameTag,
        TikzPictureEnvName: latexStructureNameTag,
        FigureEnvName: latexStructureNameTag,
        ListEnvName: latexStructureNameTag,
        TableEnvName: latexStructureNameTag,
        BookCtrlSeq: latexStructureCommandTag,
        PartCtrlSeq: latexStructureCommandTag,
        ChapterCtrlSeq: latexStructureCommandTag,
        SectionCtrlSeq: latexStructureCommandTag,
        SubSectionCtrlSeq: latexStructureCommandTag,
        SubSubSectionCtrlSeq: latexStructureCommandTag,
        ParagraphCtrlSeq: latexStructureCommandTag,
        SubParagraphCtrlSeq: latexStructureCommandTag,
        Comment: t.comment,
        VerbContent: t.meta,
        VerbatimContent: t.meta,
        LstInlineContent: t.meta,
        LiteralArgContent: t.string,
        SpaceDelimitedLiteralArgContent: t.string,
        OpenBrace: t.bracket,
        CloseBrace: t.bracket,
        OpenBracket: t.bracket,
        CloseBracket: t.bracket,
        Begin: latexStructureCommandTag,
        End: latexStructureCommandTag,
        TextBoldCtrlSeq: t.strong,
        TextItalicCtrlSeq: t.emphasis,
        TextSmallCapsCtrlSeq: t.className,
        TextTeletypeCtrlSeq: t.monospace,
        EmphasisCtrlSeq: t.emphasis,
        UnderlineCtrlSeq: t.emphasis,
        TitleCtrlSeq: t.heading,
        AuthorCtrlSeq: t.heading,
        DateCtrlSeq: t.heading,
        Number: t.number,
        Normal: t.content,
        Ampersand: t.operator,
        Tilde: t.operator,
        TrailingContent: t.invalid,
        DocumentClassCtrlSeq: t.definitionKeyword,
        UsePackageCtrlSeq: t.keyword,
        LabelCtrlSeq: t.labelName,
        RefCtrlSeq: t.labelName,
        RefStarrableCtrlSeq: t.labelName,
        CiteCtrlSeq: t.quote,
        CiteStarrableCtrlSeq: t.quote,
        BibliographyCtrlSeq: t.heading,
        BibliographyStyleCtrlSeq: t.heading,

        // Remap display-math delimiters (\[ and \]) into the math family.
        OpenBracketCtrlSym: t.processingInstruction,
        CloseBracketCtrlSym: t.processingInstruction,
      }),
    ],
  }),
  languageData: {
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['(', '[', '{', '\'', '"'] },
    wordChars: '$\\-_',
  },
});

export function latex(config: {
  autoCloseTags?: boolean,
  enableLinting?: boolean,
  enableAutocomplete?: boolean,
  autoCloseBrackets?: boolean,
} = {}) {
  const options = {
    ...config,
    autoCloseTags: config.autoCloseTags ?? true,
    enableLinting: config.enableLinting ?? true,
    enableAutocomplete: config.enableAutocomplete ?? true,
    autoCloseBrackets: config.autoCloseBrackets ?? true,
  };

  const extensions = [];

  extensions.push(
    latexLanguage.data.of({
      autocomplete: latexCompletionSource(options.autoCloseTags),
    }),
  );
  extensions.push(foldService.of(commentFoldRanges));

  if (options.enableAutocomplete) {
    extensions.push(autocompletion({
      override: [latexCompletionSource(options.autoCloseTags)],
      defaultKeymap: true,
      activateOnTyping: true,
      icons: true,
    }));
    extensions.push(keymap.of(completionKeymap));
  }

  extensions.push(latexBracketMatching);

  if (options.autoCloseBrackets) {
    extensions.push(closeBrackets());
  }

  if (options.autoCloseTags) {
    extensions.push(...autoCloseTags);
  }

  if (options.enableLinting) {
    // `checkMissingDocumentEnv` warns whenever a document over 100 characters
    // has no \begin{document}, underlining its first 200 characters. Sources
    // here are fragments -- blueprint chapters, pasted problem statements --
    // which legitimately have no document environment, so the rule only ever
    // fires as a false positive.
    extensions.push(linter(latexLinter({ checkMissingDocumentEnv: false })));
  }

  return new LanguageSupport(latexLanguage, extensions);
}
