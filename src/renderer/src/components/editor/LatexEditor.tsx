/**
 * LaTeX editor with a file-name header (optionally a link to the source file).
 *
 * around `CodeEditor` fixed to the LaTeX language, plus a header row.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { Extension } from '@codemirror/state';
import { CodeEditor } from '@/components/editor/CodeEditor';

interface LatexEditorProps {
  /** Blend into a parent code surface instead of drawing another frame. */
  embedded?: boolean;
  headerActions?: ReactNode;
  value?: string;
  onChange?: (value: string) => void;
  fileName?: string;
  fileUrl?: string;
  readonly?: boolean;
  latexLinting?: boolean;
  lineWrapping?: boolean;
  fillHeight?: boolean;
  pageScroll?: boolean;
  placeholder?: string;
  extensions?: Extension[];
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--code-border)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
  background: 'var(--code-bg)',
};

// `fillHeight` asks the editor to fill its box, but the box is this container:
// left at its content height, the percentage height CodeEditor applies to
// `.cm-editor` resolves against an auto-height parent and collapses to auto, so
// the editor grows with the document and overflows whatever the caller sized.
// Filling the caller's box here is what gives CodeMirror a bounded height to
// scroll inside.
const fillHeightContainerStyle: CSSProperties = {
  ...containerStyle,
  height: '100%',
  minHeight: 0,
};

const headerStyle: CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--code-header-bg)',
  borderBottom: '1px solid var(--code-border)',
  fontFamily: 'var(--numina-font-mono)',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--font-weight-semibold)',
  color: 'var(--code-header-text)',
};

const headerLinkStyle: CSSProperties = {
  ...headerStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  textDecoration: 'none',
  cursor: 'pointer',
};

const iconStyle: CSSProperties = {
  width: 12,
  height: 12,
  flexShrink: 0,
  opacity: 0.5,
  marginTop: -2,
};

export function LatexEditor({
  embedded = false,
  headerActions,
  value,
  onChange,
  fileName = 'source.tex',
  fileUrl = '',
  readonly = false,
  latexLinting = true,
  lineWrapping = false,
  fillHeight = true,
  pageScroll = false,
  placeholder,
  extensions = [],
}: LatexEditorProps) {
  return (
    <div style={{ ...(fillHeight ? fillHeightContainerStyle : containerStyle), ...(embedded ? { border: 'none', borderRadius: 0 } : {}) }}>
      {fileUrl ? (
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={headerLinkStyle}
          className="hover:underline"
        >
          {fileName}
          <svg
            style={iconStyle}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      ) : (
        <div style={{ ...headerStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span>{fileName}</span>{headerActions}</div>
      )}
      <CodeEditor
        value={value}
        onChange={onChange}
        language="latex"
        readonly={readonly}
        latexLinting={latexLinting}
        lineWrapping={lineWrapping}
        placeholder={placeholder}
        fillHeight={fillHeight}
        pageScroll={pageScroll}
        extensions={extensions}
        className="flex-1 min-h-0"
      />
    </div>
  );
}
