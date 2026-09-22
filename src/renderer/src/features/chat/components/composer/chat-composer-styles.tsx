/** Styles stay local so multiple composer placements remain self-contained. */
export function ChatComposerStyles() {
  return (
    <style>{`
      .chat-input-wrap {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--numina-border-light);
        border-radius: var(--radius-lg);
        padding: var(--space-4) var(--space-4) var(--space-2);
        background: var(--numina-card-bg);
        transition: border-color 0.15s;
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      .chat-input-wrap:has(.chat-input:focus) { border-color: var(--numina-border-strong); }
      .chat-input-field { position: relative; width: 100%; min-width: 0; }
      .chat-input,
      .chat-input-ghost {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        margin: 0;
        border: none;
        padding: var(--space-1) 0 0;
        font-family: inherit;
        font-size: var(--text-sm);
        line-height: 20px;
        white-space: pre-wrap;
        overflow-wrap: break-word;
      }
      .chat-input {
        position: relative;
        resize: none;
        outline: none;
        background: transparent;
        color: var(--text-primary);
        overflow-y: hidden;
      }
      .chat-input-ghost {
        position: absolute;
        inset: 0;
        pointer-events: none;
        color: var(--text-muted);
        opacity: 0.7;
        overflow: hidden;
      }
      .chat-input-footer {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        margin-top: var(--space-6);
      }
      .chat-input-actions { display: flex; gap: var(--space-2); }
      .chat-input-tab {
        display: inline-block;
        margin-left: 8px;
        padding: 1px 5px;
        font-family: var(--numina-font-mono);
        font-size: 0.625rem;
        font-weight: var(--font-weight-medium);
        line-height: 1;
        vertical-align: middle;
        color: var(--text-muted);
        border: 1px solid var(--numina-border);
        border-radius: var(--radius-sm);
      }
      .send-icon { width: 14px; height: 14px; }
      .stop-icon { width: 14px; height: 14px; border-radius: 3px; background: currentColor; }
    `}</style>
  );
}
