import { DOCUMENT_REFERENCE_KINDS } from './tables';
import {
  escapeHtml,
  type ReferenceDict,
  type ReferenceTarget,
} from './scan-helpers';

export function escapeRenderAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

export function documentAnchorId(kind: string, label: string): string {
  return `${kind === 'equation' ? 'eq' : 'sec'}-${label}`;
}

export function renderReferenceLink(
  commandName: string,
  label: string,
  target: ReferenceTarget,
): string {
  const text = referenceText(commandName, target);
  const isDocument = DOCUMENT_REFERENCE_KINDS.has(target.kind);
  const attribute = isDocument ? 'data-doc-ref' : 'data-uses-ref';
  const className = isDocument ? 'doc-doc-ref' : 'doc-decl-ref';
  return (
    `<a class="${className}" ${attribute}="${escapeRenderAttribute(label)}"`
    + ` role="link" tabindex="0">${escapeHtml(text)}</a>`
  );
}

function referenceText(commandName: string, target: ReferenceTarget): string {
  if (commandName === 'eqref') return `(${target.number})`;
  if (commandName === 'cref') {
    const kind = target.kind
      ? target.kind.charAt(0).toUpperCase() + target.kind.slice(1)
      : target.kind;
    return `${kind} ${target.number}`;
  }
  return target.number;
}

export function wrapEquation(
  mathHtml: string,
  labels: string[],
  references: ReferenceDict,
): string {
  const [primary, ...rest] = labels;
  const anchors = rest.map(renderEquationAnchor).join('');
  const target = references[primary];
  const number = target && typeof target === 'object' ? target.number : '';
  const tag = number
    ? `<span class="doc-equation-tag">(${escapeHtml(number)})</span>`
    : '';
  return (
    `<div class="doc-equation" id="${escapeRenderAttribute(documentAnchorId('equation', primary))}"`
    + ` data-doc-anchor="${escapeRenderAttribute(primary)}">${anchors}${mathHtml}${tag}</div>`
  );
}

function renderEquationAnchor(label: string): string {
  return (
    `<span class="doc-equation-anchor" id="${escapeRenderAttribute(documentAnchorId('equation', label))}"`
    + ` data-doc-anchor="${escapeRenderAttribute(label)}"></span>`
  );
}
