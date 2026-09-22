import { useEffect, useRef } from 'react';
import { markSessionSeen, useSessionAttention } from '@/hooks/use-session-attention';

/** Seeing the end of a response is a read receipt, never approval of its work. */
export function useChatReadReceipt(conversationId: string | null, enabled: boolean, renderedRevision?: string) {
  const endRef = useRef<HTMLDivElement>(null);
  const attention = useSessionAttention().find((entry) => entry.id === conversationId);
  const revision = renderedRevision ?? attention?.revision;
  const unread = attention?.unread === true;
  const idle = attention?.state !== 'running' && attention?.state !== 'needs_input';
  useEffect(() => {
    const end = endRef.current;
    if (!end || !conversationId || !enabled || !unread || !idle || !revision || revision !== attention?.revision) return;
    let visible = false;
    let cancelled = false;
    let pending = false;
    let acknowledged = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timeout);
      if (!visible || document.visibilityState !== 'visible' || !document.hasFocus() || pending || acknowledged) return;
      timeout = setTimeout(() => {
        if (cancelled || !visible || !document.hasFocus() || document.visibilityState !== 'visible') return;
        pending = true;
        void markSessionSeen(conversationId, revision).then(() => { acknowledged = true; }).catch(() => {
          // A newer turn or temporary disconnection leaves the response unread.
        }).finally(() => {
          pending = false;
          if (!cancelled && !acknowledged) timeout = setTimeout(check, 2000);
        });
      }, 400);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting === true; check(); }, { threshold: 1 });
    observer.observe(end);
    window.addEventListener('focus', check);
    window.addEventListener('blur', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      observer.disconnect();
      window.removeEventListener('focus', check);
      window.removeEventListener('blur', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [conversationId, enabled, unread, idle, revision, attention?.revision]);
  return endRef;
}
