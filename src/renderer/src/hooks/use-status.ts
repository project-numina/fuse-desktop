/**
 * Hook for computing formalization status (proved, formalized, etc.) from
 * blueprint entry data.
 *
 * reactive state, so the port is pure functions returned behind a stable object.
 *
 * Status is sourced from the backend-served entries, whose ``status`` is
 * derived from the ``\leanok`` markers in the blueprint ``.tex`` (ADR 028).
 * The explicit ``status`` field is authoritative when it names a known state
 * (``proved`` -> terminal, ``in_progress`` -> Formalized). A terminal entry
 * displays as Proved for proof-required kinds and Formalized for
 * statement-only kinds. Otherwise we fall back to ``lean_name`` presence so a
 * declaration the formalizer just linked to a Lean name still shows
 * "Formalized" before its status is written.
 */

import { declarationRequiresProof } from '@/lib/declaration-kind';

interface StatusEntry {
  kind?: string;
  label: string;
  lean_name?: string;
  leanName?: string;
  status?: string;
}

/** Infers status from a blueprint entry's data. */
function statusOf(label: string, entries?: StatusEntry[]): string {
  if (!entries) return 'not_started';
  const entry = entries.find((item) => item.label === label);
  if (!entry) return 'not_started';
  if (entry.status === 'proved') return 'proved';
  // A statement-level \leanok (in_progress) renders as Formalized straight
  // from the status, not gated on a Lean name being present.
  if (entry.status === 'in_progress') return 'formalized';
  // An explicit not_started is authoritative: a preserved Lean name (the
  // source-override rule keeps lean fields when the .tex has no \leanok)
  // must not flip an unformalized declaration to Formalized.
  if (entry.status === 'not_started') return 'not_started';
  // Status absent/empty (no server data yet): fall back to lean_name.
  const leanName = entry.lean_name || entry.leanName || '';
  if (leanName) return 'formalized';
  return 'not_started';
}

/** Returns a display badge (text + CSS class) for a declaration's status. */
function statusBadge(
  status: string,
  label: string,
  entries: StatusEntry[],
): { text: string; class: string } {
  if (status === 'proved') {
    const entry = entries.find((item) => item.label === label);
    // Only an explicitly proof-required kind may claim "Proved". Missing kind
    // data stays conservative instead of silently recreating issue #865.
    const text = entry?.kind !== undefined && declarationRequiresProof(entry.kind)
      ? 'Proved'
      : 'Formalized';
    return { text, class: 'status-proved' };
  }
  if (status === 'formalized' || status === 'sorry') {
    return { text: 'Formalized', class: 'status-formalized' };
  }
  return { text: 'Unformalized', class: 'status-unformalized' };
}

/** Returns a human-readable label for a pull request status. */
function pullRequestStatusLabel(status: string): string {
  if (status === 'open') return 'Open';
  if (status === 'draft') return 'Draft';
  if (status === 'merged') return 'Merged';
  if (status === 'closed') return 'Closed';
  return status;
}

// Frozen, module-level surface so `useStatus()` returns a stable reference.
const statusApi = { statusOf, statusBadge, pullRequestStatusLabel } as const;

export function useStatus() {
  return statusApi;
}
