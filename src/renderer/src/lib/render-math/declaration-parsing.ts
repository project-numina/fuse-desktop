import { declarationRequiresProof } from '@/lib/declaration-kind';
import type {
  DeclarationMetadata,
  StatusDict,
} from './scan-helpers';

export type ResolvedStatus = {
  kind: 'proved' | 'formalized' | 'unformalized';
  label: string;
};

export function readDeclarationMetadata(body: string): DeclarationMetadata {
  const metadata: DeclarationMetadata = {
    label: '',
    leanName: '',
    uses: [],
    leanOk: false,
  };
  const labelMatch = /\\label\s*\{([^}]*)\}/.exec(body);
  if (labelMatch) metadata.label = labelMatch[1].trim();
  const leanMatch = /\\lean\s*\{([^}]*)\}/.exec(body);
  if (leanMatch) metadata.leanName = leanMatch[1].trim();
  const usesMatch = /\\uses\s*\{([\s\S]*?)\}/.exec(body);
  if (usesMatch) {
    metadata.uses = usesMatch[1]
      .split(',')
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0);
  }
  metadata.leanOk = /\\leanok\b/.test(body);
  return metadata;
}

export function resolveDeclarationStatus(
  metadata: DeclarationMetadata,
  statuses: StatusDict,
): ResolvedStatus | null {
  const value = metadata.label ? statuses[metadata.label] : '';
  const recorded = typeof value === 'string' ? value : value?.status || '';
  const kind = typeof value === 'string' ? undefined : value?.kind;
  if (recorded === 'proved') {
    const label = kind !== undefined && declarationRequiresProof(kind)
      ? 'Proved'
      : 'Formalized';
    return { kind: 'proved', label };
  }
  if (recorded === 'formalized' || recorded === 'in_progress' || recorded === 'sorry') {
    return { kind: 'formalized', label: 'Formalized' };
  }
  if (recorded === 'not_started') {
    return { kind: 'unformalized', label: 'Unformalized' };
  }
  if (metadata.leanName || metadata.leanOk) {
    return { kind: 'formalized', label: 'Formalized' };
  }
  return { kind: 'unformalized', label: 'Unformalized' };
}
