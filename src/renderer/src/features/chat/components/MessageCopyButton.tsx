import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function MessageCopyButton({ text }: { text: string }) {
  const [result, setResult] = useState<{ text: string; status: 'copied' | 'error' } | null>(null);
  const status = result?.text === text ? result.status : null;
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 2000);
    return () => clearTimeout(timer);
  }, [result]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setResult({ text, status: 'copied' });
    } catch { setResult({ text, status: 'error' }); }
  };
  return (
    <>
      <button type="button" className="message-copy-button" aria-label={status === 'copied' ? 'Copied' : 'Copy message'} title={status === 'copied' ? 'Copied' : 'Copy message'} onClick={() => void copy()}>
        {status === 'copied' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      </button>
      <span role={status ? 'status' : undefined} aria-live="polite" className={status === 'error' ? 'message-copy-error' : 'sr-only'}>{status === 'copied' ? 'Message copied' : status === 'error' ? 'Could not copy. Try again.' : ''}</span>
    </>
  );
}
