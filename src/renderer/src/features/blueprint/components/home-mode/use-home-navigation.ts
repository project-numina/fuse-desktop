import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';

import type { HomeModeProps } from '../HomeMode';
import type { useHomeDocument } from './use-home-document';

type ReferenceKind = 'declaration' | 'document';
type DocumentModel = ReturnType<typeof useHomeDocument>;
type NavigationEvent = ReactMouseEvent<HTMLDivElement> | ReactKeyboardEvent<HTMLDivElement>;
type NavigateToReference = (label: string, kind: ReferenceKind) => Promise<void>;
type ScrollToTarget = (label: string, kind: ReferenceKind) => void;

interface PendingNavigation {
  label: string;
  kind: ReferenceKind;
  path: string;
}

interface NavigationRefs {
  docBody: RefObject<HTMLDivElement | null>;
  pending: RefObject<PendingNavigation | null>;
  lastHandledHash: RefObject<string | null>;
}

interface NavigationContext {
  props: HomeModeProps;
  model: DocumentModel;
  refs: NavigationRefs;
  navigateToReference: NavigateToReference;
}

function eventReference(event: NavigationEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const documentLink = target?.closest('[data-doc-ref]');
  if (documentLink) {
    return { label: documentLink.getAttribute('data-doc-ref') ?? '', kind: 'document' as const };
  }
  const declarationLink = target?.closest('[data-uses-ref]');
  if (declarationLink) {
    return {
      label: declarationLink.getAttribute('data-uses-ref') ?? '',
      kind: 'declaration' as const,
    };
  }
  return null;
}

function moveUsesAfterProof(root: HTMLDivElement) {
  root.querySelectorAll('.doc-decl').forEach((declaration) => {
    const uses = declaration.querySelector(':scope > .doc-decl-uses');
    if (!uses) return;
    let sibling = declaration.nextElementSibling;
    let proof: Element | null = null;
    const spacers: Element[] = [];
    let sawProse = false;
    while (sibling && !sibling.classList.contains('doc-decl')) {
      if (sibling.classList.contains('doc-proof')) {
        proof = sibling;
        break;
      }
      const isSpacer = sibling.tagName === 'BR'
        || sibling.classList.contains('paragraph-break')
        || !(sibling.textContent ?? '').trim();
      if (isSpacer) spacers.push(sibling);
      else sawProse = true;
      sibling = sibling.nextElementSibling;
    }
    if (!proof) {
      declaration.appendChild(uses);
      return;
    }
    if (!sawProse) spacers.forEach((spacer) => spacer.remove());
    proof.after(uses);
  });
}

function currentDeclarationLabel(root: HTMLDivElement | null, from: Element | null) {
  if (!from) return null;
  const containing = from.closest('[data-decl-label]');
  if (containing) return containing.getAttribute('data-decl-label');
  let current: string | null = null;
  for (const declaration of root?.querySelectorAll('[data-decl-label]') ?? []) {
    if (from.compareDocumentPosition(declaration) & Node.DOCUMENT_POSITION_PRECEDING) {
      current = declaration.getAttribute('data-decl-label');
    } else break;
  }
  return current;
}

function updateHistory(hash: string, replace: boolean, onNavigateHash?: HomeModeProps['onNavigateHash']) {
  if (onNavigateHash) {
    onNavigateHash(hash, replace);
    return;
  }
  const url = new URL(window.location.href);
  url.hash = hash;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method](window.history.state, '', url);
}

function recordCurrentPosition(context: NavigationContext, from: Element | null) {
  const { onNavigateHash } = context.props;
  const { declarationReferences } = context.model;
  const label = currentDeclarationLabel(context.refs.docBody.current, from);
  const target = label ? declarationReferences[label] : undefined;
  if (target && typeof target === 'object' && window.location.hash !== `#${target.number}`) {
    updateHistory(target.number, true, onNavigateHash);
  }
}

function openLeanTarget(context: NavigationContext, target: Element | null) {
  const { onOpenLeanFile } = context.props;
  const leanName = target?.closest('.doc-decl-lean');
  if (!leanName || !onOpenLeanFile) return false;
  const label = leanName.closest('[data-decl-label]')?.getAttribute('data-decl-label');
  const leanTarget = label ? context.model.leanTargetByLabel.get(label) : undefined;
  if (!leanTarget) return false;
  recordCurrentPosition(context, target);
  onOpenLeanFile(leanTarget.file, leanTarget.line);
  return true;
}

function referenceFragment(context: NavigationContext, label: string, kind: ReferenceKind) {
  const target = kind === 'declaration'
    ? context.model.declarationReferences[label]
    : context.model.documentIndex.references[label];
  if (!target || typeof target !== 'object') return null;
  return kind === 'declaration'
    ? target.number
    : `${target.kind === 'equation' ? 'eq' : 'sec'}-${label}`;
}

function navigateWithHistory(
  context: NavigationContext,
  label: string,
  kind: ReferenceKind,
  from: Element | null,
) {
  recordCurrentPosition(context, from);
  const fragment = referenceFragment(context, label, kind);
  if (fragment) {
    context.refs.lastHandledHash.current = `#${fragment}`;
    updateHistory(fragment, false, context.props.onNavigateHash);
  }
  void context.navigateToReference(label, kind);
}

function handleReferenceAction(context: NavigationContext, event: NavigationEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (openLeanTarget(context, target)) {
    event.preventDefault();
    return;
  }
  const reference = eventReference(event);
  if (!reference?.label) return;
  event.preventDefault();
  navigateWithHistory(context, reference.label, reference.kind, target);
}

function createBodyHandlers(context: NavigationContext) {
  return {
    handleBodyClick(event: ReactMouseEvent<HTMLDivElement>) {
      handleReferenceAction(context, event);
    },
    handleBodyKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      handleReferenceAction(context, event);
    },
  };
}

function useScrollToTarget(docBodyRef: NavigationRefs['docBody']): ScrollToTarget {
  return useCallback((label: string, kind: ReferenceKind) => {
    const attribute = kind === 'declaration' ? 'data-decl-label' : 'data-doc-anchor';
    const targets = docBodyRef.current?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [];
    const target = Array.from(targets).find(
      (element) => element.getAttribute(attribute) === label,
    );
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [docBodyRef]);
}

function useReferenceNavigator(
  props: HomeModeProps,
  model: DocumentModel,
  pendingRef: NavigationRefs['pending'],
  scrollToTarget: ScrollToTarget,
): NavigateToReference {
  const { blueprint, activeChapterPath = '', onSelectChapter } = props;
  const { documentIndex } = model;
  return useCallback(async (label: string, kind: ReferenceKind) => {
    const declaration = (blueprint.entries ?? []).find((entry) => entry.label === label);
    const targetPath = kind === 'declaration'
      ? declaration?.source_file ?? declaration?.sourceFile
      : documentIndex.chapterByLabel[label];
    if (!targetPath || targetPath === activeChapterPath || !onSelectChapter) {
      scrollToTarget(label, kind);
      return;
    }
    const pending = { label, kind, path: targetPath };
    pendingRef.current = pending;
    const selected = await onSelectChapter(targetPath);
    if (selected === false && pendingRef.current === pending) pendingRef.current = null;
  }, [
    activeChapterPath, blueprint.entries, documentIndex.chapterByLabel,
    onSelectChapter, pendingRef, scrollToTarget,
  ]);
}

function followLocationHash(context: NavigationContext, rawHash: string) {
  if (context.refs.lastHandledHash.current === rawHash) return;
  let fragment: string;
  try {
    fragment = decodeURIComponent(rawHash.replace(/^#/, ''));
  } catch {
    context.refs.lastHandledHash.current = rawHash;
    return;
  }
  if (!fragment) {
    context.refs.lastHandledHash.current = rawHash;
    return;
  }
  const documentMatch = /^(?:sec|eq)-(.+)$/.exec(fragment);
  const documentLabel = documentMatch?.[1];
  if (documentLabel) {
    if (documentLabel in context.model.documentIndex.chapterByLabel) {
      context.refs.lastHandledHash.current = rawHash;
      void context.navigateToReference(documentLabel, 'document');
    }
    return;
  }
  const declarationLabel = context.model.declarationLabelByNumber.get(fragment);
  if (declarationLabel) {
    context.refs.lastHandledHash.current = rawHash;
    void context.navigateToReference(declarationLabel, 'declaration');
  }
}

function useUsesLayoutEffect(refs: NavigationRefs, renderedBody: string) {
  useLayoutEffect(() => {
    if (refs.docBody.current) moveUsesAfterProof(refs.docBody.current);
  }, [refs, renderedBody]);
}

function usePendingNavigationEffect(
  refs: NavigationRefs,
  activeChapterPath: string,
  renderedBody: string,
  scrollToTarget: ScrollToTarget,
) {
  useEffect(() => {
    const pending = refs.pending.current;
    if (!pending || pending.path !== activeChapterPath) return;
    refs.pending.current = null;
    requestAnimationFrame(() => scrollToTarget(pending.label, pending.kind));
  }, [activeChapterPath, refs, renderedBody, scrollToTarget]);
}

function useHashNavigationEffect(context: NavigationContext, currentHash: string | undefined) {
  const { activeChapterPath = '' } = context.props;
  const { declarationLabelByNumber, documentIndex, renderedBody } = context.model;
  useEffect(() => {
    const followCurrentHash = () => followLocationHash(
      context,
      currentHash ?? window.location.hash,
    );
    followCurrentHash();
    if (currentHash !== undefined) return;
    window.addEventListener('popstate', followCurrentHash);
    window.addEventListener('hashchange', followCurrentHash);
    return () => {
      window.removeEventListener('popstate', followCurrentHash);
      window.removeEventListener('hashchange', followCurrentHash);
    };
  }, [
    activeChapterPath, context, currentHash, declarationLabelByNumber,
    documentIndex, renderedBody,
  ]);
}

function useChapterScrollReset(activeChapterPath: string) {
  useEffect(() => {
    if (!activeChapterPath) return;
    document.querySelector<HTMLElement>('.content-area')
      ?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeChapterPath]);
}

function useNavigationEffects(
  context: NavigationContext,
  scrollToTarget: ScrollToTarget,
) {
  const { activeChapterPath = '', currentHash } = context.props;
  const { renderedBody } = context.model;
  useUsesLayoutEffect(context.refs, renderedBody);
  usePendingNavigationEffect(context.refs, activeChapterPath, renderedBody, scrollToTarget);
  useHashNavigationEffect(context, currentHash);
  useChapterScrollReset(activeChapterPath);
}

export function useHomeNavigation(props: HomeModeProps, model: DocumentModel) {
  const docBodyRef = useRef<HTMLDivElement | null>(null);
  const pendingNavigationRef = useRef<PendingNavigation | null>(null);
  const lastHandledHashRef = useRef<string | null>(null);
  const refs: NavigationRefs = {
    docBody: docBodyRef,
    pending: pendingNavigationRef,
    lastHandledHash: lastHandledHashRef,
  };
  const scrollToTarget = useScrollToTarget(docBodyRef);
  const navigateToReference = useReferenceNavigator(
    props,
    model,
    pendingNavigationRef,
    scrollToTarget,
  );
  const context = { props, model, refs, navigateToReference };
  const handlers = createBodyHandlers(context);
  useNavigationEffects(context, scrollToTarget);
  return { docBodyRef, ...handlers };
}
