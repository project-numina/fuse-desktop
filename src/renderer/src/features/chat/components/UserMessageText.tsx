import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import MessageCopyButton from './MessageCopyButton';

const PREVIEW_LINES = 10;

/** Locate the last character in the preview using the actual wrapping. */
function countHiddenCharacters(element: HTMLElement, text: string, previewHeight: number): number {
  const node = element.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return 0;
  const range = document.createRange();
  range.setStart(node, 0);
  const bottom = element.getBoundingClientRect().top + previewHeight;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    range.setEnd(node, middle);
    if (range.getBoundingClientRect().bottom <= bottom + 1) low = middle;
    else high = middle - 1;
  }
  return Array.from(text.slice(low)).length;
}

/** Presentation only: the full original message stays in the transcript. */
export default function UserMessageText({ text, bubbleClassName = '', children }: { text: string; bubbleClassName?: string; children?: ReactNode }) {
  const id = useId();
  const textRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [hiddenCharacters, setHiddenCharacters] = useState(0);
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const expanded = expandedText === text;

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
      const clipped = element.scrollHeight > lineHeight * PREVIEW_LINES + 1;
      setOverflows(clipped);
      setHiddenCharacters(clipped ? countHiddenCharacters(element, text, lineHeight * PREVIEW_LINES) : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  const toggle = () => {
    setExpandedText(expanded ? null : text);
    // Collapsing from the bottom of a long message should keep its preview in view.
    const element = textRef.current;
    const scroller = element?.closest('.chat-messages');
    if (expanded && element && scroller && element.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
      requestAnimationFrame(() => { if (element.isConnected) element.scrollIntoView({ block: 'start' }); });
    }
  };

  return (
    <div className="user-message">
      <div className={`user-bubble ${bubbleClassName}`}>
        {children}
      <div id={id} className={`user-message-preview${expanded ? ' is-expanded' : ''}${overflows && !expanded ? ' is-truncated' : ''}`}>
        <div ref={textRef}>{text}</div>
      </div>
        {overflows && (
          <div className="user-message-expansion">
            <button type="button" className="user-message-toggle" aria-expanded={expanded} aria-controls={id} onClick={toggle}>
              {expanded ? 'Show less' : 'Show more'}
              {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </button>
            {!expanded && hiddenCharacters > 0 && <span className="user-message-hidden-count">{hiddenCharacters.toLocaleString()} characters hidden</span>}
          </div>
        )}
      </div>
      <div className="user-message-actions">
        <MessageCopyButton text={text} />
      </div>
    </div>
  );
}
