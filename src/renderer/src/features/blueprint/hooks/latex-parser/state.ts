import type { BlueprintEntry } from './types';

export function entriesToLatex(entries: BlueprintEntry[]): string {
  return entries.map((entry) => {
    let text = `\\begin{${entry.kind}}[${entry.title}]\n\\label{${entry.label}}\n`;
    const leanName = entry.lean_name || entry.leanName || '';
    const leanFile = entry.lean_file || entry.leanFile || '';
    if (leanName) text += `\\lean{${leanName}}\n`;
    if (leanFile) text += `\\leanfile{${leanFile}}\n`;
    if (entry.uses?.length) text += `\\uses{${entry.uses.join(', ')}}\n`;
    text += `\n${entry.statement}\n\\end{${entry.kind}}`;
    if (entry.proof) text += `\n\\begin{proof}\n${entry.proof}\n\\end{proof}`;
    return text;
  }).join('\n\n');
}

function normalizeServerEntry(entry: BlueprintEntry): BlueprintEntry {
  return {
    ...entry,
    leanName: entry.lean_name || entry.leanName || '',
    leanFile: entry.lean_file || entry.leanFile || '',
    uses: entry.uses || [],
    status: entry.status || '',
    proof: entry.proof ?? null,
  };
}

interface ServerMetadata {
  issues: Map<string, unknown>;
  statuses: Map<string, string>;
  leanNames: Map<string, string>;
  proofs: Map<string, string>;
}

function indexServerMetadata(serverEntries: BlueprintEntry[]): ServerMetadata {
  const metadata: ServerMetadata = {
    issues: new Map(),
    statuses: new Map(),
    leanNames: new Map(),
    proofs: new Map(),
  };
  for (const entry of serverEntries) {
    if (entry.issues) metadata.issues.set(entry.label, entry.issues);
    if (entry.status) metadata.statuses.set(entry.label, entry.status);
    if (entry.proof != null) metadata.proofs.set(entry.label, entry.proof);
    const leanName = entry.lean_name || entry.leanName || '';
    if (leanName) metadata.leanNames.set(entry.label, leanName);
  }
  return metadata;
}

function mergeEntryMetadata(entry: BlueprintEntry, metadata: ServerMetadata): void {
  const issues = metadata.issues.get(entry.label);
  const status = metadata.statuses.get(entry.label);
  const leanName = metadata.leanNames.get(entry.label);
  if (issues) entry.issues = issues;
  if (status) entry.status = status;
  if (entry.proof === null && metadata.proofs.has(entry.label)) {
    entry.proof = metadata.proofs.get(entry.label) ?? null;
  }
  if (!entry.leanName && leanName) entry.leanName = leanName;
}

/** Reconciles locally parsed structure with authoritative server metadata. */
export function mergeParsedEntries(
  parsedEntries: BlueprintEntry[],
  serverEntries?: BlueprintEntry[],
): BlueprintEntry[] {
  const entries = parsedEntries.map((entry) => ({ ...entry, uses: [...entry.uses] }));
  if (entries.length === 0 && serverEntries?.length) {
    return serverEntries.map(normalizeServerEntry);
  }
  if (!serverEntries) return entries;
  const metadata = indexServerMetadata(serverEntries);
  entries.forEach((entry) => mergeEntryMetadata(entry, metadata));
  return entries;
}
