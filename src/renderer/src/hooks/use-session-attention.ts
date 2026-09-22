import { useSyncExternalStore } from 'react';
import type { SessionAttention } from '@shared/session-attention';
import { request } from '@/lib/api/core';
import { notifySessionHistoryChanged } from '@/lib/session-events';

let snapshot: SessionAttention[] = [];
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let pending: Promise<void> | undefined;
let generation = 0;

export function refreshSessionAttention(): Promise<void> {
  if (pending) return pending;
  const current = generation;
  pending = request<SessionAttention[]>('/sessions/attention').then((entries) => {
    if (current !== generation || !Array.isArray(entries)) return;
    if (JSON.stringify(entries) === JSON.stringify(snapshot)) return;
    snapshot = entries;
    listeners.forEach((listener) => listener());
  }).catch(() => { /* Keep the last known state while reconnecting. */ }).finally(() => { pending = undefined; });
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    void refreshSessionAttention();
    timer = setInterval(() => { void refreshSessionAttention(); }, 2000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
      generation += 1;
      snapshot = [];
    }
  };
}

export function useSessionAttention(): SessionAttention[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export async function markSessionSeen(id: string, revision: string): Promise<void> {
  await request(`/sessions/history/${encodeURIComponent(id)}/seen`, { method: 'POST', body: JSON.stringify({ revision }) });
  generation += 1; // An older poll must not resurrect this receipt.
  snapshot = snapshot.map((entry) => entry.id === id && entry.revision === revision ? { ...entry, unread: false } : entry);
  listeners.forEach((listener) => listener());
  notifySessionHistoryChanged(id);
}
