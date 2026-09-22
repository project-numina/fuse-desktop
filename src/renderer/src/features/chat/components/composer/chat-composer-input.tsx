import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type Ref,
} from 'react';

const LINE_HEIGHT = 20;
const MAX_HEIGHT = LINE_HEIGHT * 10;

export interface ChatComposerHandle {
  focus: () => void;
}

interface ComposerInputOptions {
  value: string;
  placeholder: string;
  placeholderCompletable: boolean;
  canSend: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  forwardedRef: Ref<ChatComposerHandle>;
}

export function useComposerInput(options: ComposerInputOptions) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const ghostRef = useRef<HTMLPreElement | null>(null);
  const minimumTypedHeightRef = useRef(0);
  const ghostText = options.value ? '' : options.placeholder;
  const showGhost = Boolean(ghostText);
  const autoResize = useCallback(() => {
    resizeInput(textareaRef.current, ghostRef.current, minimumTypedHeightRef, showGhost);
  }, [showGhost]);
  useLayoutEffect(() => {
    autoResize();
  }, [options.value, options.placeholder, autoResize]);
  const focus = useCallback(() => {
    // Focus after any render or layout work triggered by the caller.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);
  useImperativeHandle(options.forwardedRef, () => ({ focus }), [focus]);
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    handleComposerKeyDown(event, options, showGhost);
  }, [options, showGhost]);
  return { textareaRef, ghostRef, ghostText, showGhost, autoResize, focus, handleKeyDown };
}

function resizeInput(
  textarea: HTMLTextAreaElement | null,
  ghost: HTMLPreElement | null,
  minimumTypedHeightRef: React.MutableRefObject<number>,
  showGhost: boolean,
): void {
  if (!textarea) return;
  textarea.style.height = 'auto';
  const textareaHeight = textarea.scrollHeight;
  const ghostHeight = showGhost && ghost ? ghost.scrollHeight : 0;
  const contentHeight = Math.max(textareaHeight, ghostHeight);
  // Preserve a one-line empty height when typing begins, but do not let a
  // wrapping suggestion pin a short typed message to several empty lines.
  if (showGhost) {
    const ghostIsSingleLine = ghostHeight <= textareaHeight + LINE_HEIGHT / 2;
    minimumTypedHeightRef.current = Math.min(
      ghostIsSingleLine ? contentHeight : textareaHeight,
      MAX_HEIGHT,
    );
  }
  const stableHeight = Math.max(contentHeight, minimumTypedHeightRef.current);
  textarea.style.height = `${Math.min(stableHeight, MAX_HEIGHT)}px`;
  textarea.style.overflowY = contentHeight > MAX_HEIGHT ? 'auto' : 'hidden';
}

function handleComposerKeyDown(
  event: KeyboardEvent<HTMLTextAreaElement>,
  options: ComposerInputOptions,
  showGhost: boolean,
): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (options.canSend) options.onSend();
    return;
  }
  if (event.key === 'Tab' && !event.shiftKey && showGhost && options.placeholderCompletable) {
    event.preventDefault();
    options.onChange(options.placeholder);
  }
}

interface ComposerInputProps {
  value: string;
  placeholder: string;
  placeholderCompletable: boolean;
  model: ReturnType<typeof useComposerInput>;
  onChange: (value: string) => void;
}

/** Textarea and its tab-completable ghost share exactly the same geometry. */
export function ComposerInput({
  value,
  placeholder,
  placeholderCompletable,
  model,
  onChange,
}: ComposerInputProps) {
  return (
    <div className="chat-input-field">
      {model.showGhost ? (
        <pre ref={model.ghostRef} className="chat-input-ghost" aria-hidden="true">
          <span className="chat-input-ghost-text">{model.ghostText}</span>
          {placeholderCompletable ? <kbd className="chat-input-tab">Tab</kbd> : null}
        </pre>
      ) : null}
      <textarea
        ref={model.textareaRef}
        value={value}
        aria-label={placeholder}
        rows={1}
        className="chat-input"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={model.handleKeyDown}
        onInput={model.autoResize}
      />
    </div>
  );
}
