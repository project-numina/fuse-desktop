import { parseSseEventData } from '@/lib/sse';

export function eventPhase(event: Event): string | null | undefined | false {
  const data = parseSseEventData<{ phase?: unknown }>(event);
  if (!data || !(typeof data.phase === 'string' || data.phase == null)) return false;
  return data.phase as string | null | undefined;
}

export function eventFiles(event: Event): object | null {
  const data = parseSseEventData<{ files?: unknown }>(event);
  return data?.files && typeof data.files === 'object' ? data.files : null;
}

export function eventLatexSource(event: Event): string | null {
  const data = parseSseEventData<{ latex_source?: unknown }>(event);
  return typeof data?.latex_source === 'string' ? data.latex_source : null;
}

export function eventBuildSnapshot(
  event: Event,
): { done: boolean; hasSteps: boolean } | null {
  const data = parseSseEventData<{ status?: unknown; steps?: unknown }>(event);
  if (!data) return null;
  return {
    done: data.status === 'done',
    hasSteps: Array.isArray(data.steps) && data.steps.length > 0,
  };
}

export function eventPayload<T>(event: Event): T | null {
  return parseSseEventData(event) as unknown as T | null;
}
