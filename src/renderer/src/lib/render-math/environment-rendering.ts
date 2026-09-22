import {
  DECLARATION_ENVIRONMENTS,
  MATH_ENVIRONMENTS,
  NUMBERED_MATH_ENVIRONMENTS,
  STRIP_COMMAND_PATTERN,
} from './tables';
import {
  escapeHtml,
  extractBraceArg,
  extractDeclarationMetadata,
  extractOptionalArg,
  findEndEnvironment,
  readEquationLabels,
  renderKatex,
  resolveStatus,
  splitOnItem,
  type DeclarationMetadata,
} from './scan-helpers';
import { escapeRenderAttribute, wrapEquation } from './reference-rendering';
import type { RecursiveRenderer, RenderContext } from './render-types';

export function handleBeginEnvironment(
  input: string,
  pos: number,
  out: string[],
  depth: number,
  context: RenderContext,
  scan: RecursiveRenderer,
): number {
  const environment = readEnvironment(input, pos, out);
  if (!environment) return pos;
  if ('unclosed' in environment) return environment.afterEnvName;

  const { envName, body, endResult } = environment;
  if (MATH_ENVIRONMENTS.has(envName)) {
    out.push(renderMathEnvironment(envName, body, context));
  } else if (envName === 'enumerate' || envName === 'itemize') {
    out.push(renderListEnvironment(envName, body, depth, context, scan));
  } else if (DECLARATION_ENVIRONMENTS.has(envName)) {
    out.push(renderDeclarationEnvironment(envName, body, depth, context, scan));
  } else if (envName === 'proof') {
    out.push(renderProofEnvironment(body, depth, context, scan));
  } else {
    out.push(scan(body, depth + 1, context));
  }
  return endResult;
}

type ParsedEnvironment = {
  envName: string;
  body: string;
  endResult: number;
} | {
  unclosed: true;
  afterEnvName: number;
};

function readEnvironment(
  input: string,
  pos: number,
  out: string[],
): ParsedEnvironment | null {
  const envArg = extractBraceArg(input, pos);
  if (!envArg) {
    out.push(escapeHtml('\\begin'));
    return null;
  }
  const envName = envArg.content;
  const endResult = findEndEnvironment(input, envArg.afterClose, envName);
  if (endResult === -1) {
    out.push(escapeHtml(`\\begin{${envName}}`));
    return { unclosed: true, afterEnvName: envArg.afterClose };
  }
  const endTag = `\\end{${envName}}`;
  const body = input.slice(envArg.afterClose, endResult - endTag.length);
  return { envName, body, endResult };
}

function renderMathEnvironment(
  envName: string,
  body: string,
  context: RenderContext,
): string {
  const numbered = NUMBERED_MATH_ENVIRONMENTS.has(envName);
  const labels = numbered ? readEquationLabels(body) : [];
  const cleanedBody = body.replace(STRIP_COMMAND_PATTERN, '');
  const katexEnv = envName === 'multline' || envName === 'multline*'
    ? 'gathered'
    : numbered ? `${envName}*` : envName;
  const tex = `\\begin{${katexEnv}}${cleanedBody}\\end{${katexEnv}}`;
  const html = renderKatex(tex, true, context.macros, context.references);
  return labels.length > 0 ? wrapEquation(html, labels, context.references) : html;
}

function renderListEnvironment(
  envName: string,
  body: string,
  depth: number,
  context: RenderContext,
  scan: RecursiveRenderer,
): string {
  const tag = envName === 'enumerate' ? 'ol' : 'ul';
  const items = splitOnItem(body)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => scan(item, depth + 1, context).replace(/^(<br>)+/, ''))
    .map(html => `<li>${html}</li>`)
    .join('');
  return `<${tag} class="latex-list">${items}</${tag}>`;
}

function renderDeclarationEnvironment(
  envName: string,
  body: string,
  depth: number,
  context: RenderContext,
  scan: RecursiveRenderer,
): string {
  const optional = extractOptionalArg(body, 0);
  const declarationBody = body.slice(optional ? optional.afterClose : 0);
  const metadata = extractDeclarationMetadata(declarationBody);
  const title = optional ? scan(optional.content, depth + 1, context) : '';
  const bodyHtml = scan(declarationBody.trim(), depth + 1, context);
  const anchor = metadata.label
    ? ` data-decl-label="${escapeRenderAttribute(metadata.label)}"`
    : '';
  return [
    `<div class="doc-decl doc-decl-${envName}"${anchor}>`,
    renderDeclarationHeading(title, metadata, context),
    renderDeclarationLabel(metadata),
    renderLeanName(metadata, context.linkedDeclarations),
    renderUses(metadata),
    `<div class="doc-decl-body">${bodyHtml}</div>`,
    '</div>',
  ].join('');
}

function renderDeclarationHeading(
  title: string,
  metadata: DeclarationMetadata,
  context: RenderContext,
): string {
  const status = resolveStatus(metadata, context.statuses);
  const titleHtml = title
    ? ` <span class="doc-decl-title">(${title})</span>`
    : '';
  const statusHtml = status
    ? ` <span class="doc-decl-status status-${status.kind}">${status.label}</span>`
    : '';
  return (
    '<div class="doc-decl-head"><span class="doc-decl-counter"></span>'
    + `${titleHtml}<span class="doc-decl-period">.</span>${statusHtml}</div>`
  );
}

function renderDeclarationLabel(metadata: DeclarationMetadata): string {
  return metadata.label
    ? `<div class="doc-decl-tag">${escapeHtml(metadata.label)}</div>`
    : '';
}

function renderLeanName(
  metadata: DeclarationMetadata,
  linkedDeclarations: ReadonlySet<string>,
): string {
  if (!metadata.leanName) return '';
  const linked = linkedDeclarations.has(metadata.label);
  const linkClass = linked ? ' is-linked' : '';
  const linkAttributes = linked ? ' role="link" tabindex="0"' : '';
  return (
    `<div class="doc-decl-lean${linkClass}"${linkAttributes}>`
    + `${escapeHtml(metadata.leanName)}</div>`
  );
}

function renderUses(metadata: DeclarationMetadata): string {
  if (metadata.uses.length === 0) return '';
  const links = metadata.uses.map(renderUsesLink).join(', ');
  return (
    '<details class="doc-decl-uses">'
    + '<summary class="doc-decl-uses-summary">Uses</summary>'
    + `<div class="doc-decl-uses-list">${links}</div>`
    + '</details>'
  );
}

function renderUsesLink(reference: string): string {
  return (
    `<a class="doc-decl-uses-ref" data-uses-ref="${escapeRenderAttribute(reference)}"`
    + ` role="link" tabindex="0">${escapeHtml(reference)}</a>`
  );
}

function renderProofEnvironment(
  body: string,
  depth: number,
  context: RenderContext,
  scan: RecursiveRenderer,
): string {
  const bodyHtml = scan(body.trim(), depth + 1, context);
  return (
    '<details class="doc-proof">'
    + '<summary class="doc-proof-summary">Proof</summary>'
    + `<div class="doc-proof-body">${bodyHtml}<span class="doc-qed">□</span></div>`
    + '</details>'
  );
}
