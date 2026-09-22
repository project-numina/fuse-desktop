const SUBAGENT_EXPANDED_CSS = `
  .subagent-expanded {
    position: absolute;
    inset: 0;
    z-index: 5;
    background: var(--chat-panel-bg);
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .subagent-expanded:focus { outline: none; }
  .subagent-expanded-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    border-bottom: 1px solid var(--numina-border-light);
    flex-shrink: 0;
  }
  .subagent-expanded-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .subagent-iteration-row { display: flex; min-width: 0; }
  .subagent-expanded-title-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  .subagent-expanded-title {
    font-size: var(--text-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .close-icon { width: 16px; height: 16px; }
  .subagent-expanded-timeline {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-3) var(--space-4);
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }
  .subagent-expanded-timeline::-webkit-scrollbar { width: 3px; }
  .subagent-expanded-timeline::-webkit-scrollbar-track { background: transparent; }
  .subagent-expanded-timeline::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 2px;
  }
  .subagent-expanded-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }
  .subagent-jump-latest {
    position: absolute;
    left: 50%;
    bottom: var(--space-4);
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    min-width: 34px;
    height: 34px;
    min-height: 34px;
    padding: 0;
    color: var(--text-muted);
    cursor: pointer;
    background: var(--numina-card-bg);
    border: 1px solid var(--numina-border);
    border-radius: 50%;
    box-shadow: 0 6px 18px rgb(17 24 39 / 8%);
    backdrop-filter: blur(6px);
    transform: translateX(-50%);
    transition: transform 0.15s, background 0.15s;
  }
  .subagent-jump-latest:hover {
    background: var(--numina-card-bg);
    transform: translateX(-50%) translateY(-1px);
  }
  .subagent-jump-latest:focus-visible {
    outline: 2px solid var(--numina-accent);
    outline-offset: 2px;
  }
  .subagent-jump-latest-icon {
    width: 16px;
    height: 16px;
  }
  .waiting-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--badge-theorem-bg);
    border-top-color: var(--badge-theorem-border);
    border-radius: 50%;
    animation: numina-spin 0.8s linear infinite;
  }
  .empty-hint { font-size: var(--text-sm); color: var(--text-muted); }
`;

export default function SubagentExpandedStyles() {
  return <style>{SUBAGENT_EXPANDED_CSS}</style>;
}
