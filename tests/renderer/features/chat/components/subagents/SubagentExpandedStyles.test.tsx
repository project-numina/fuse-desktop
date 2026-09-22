import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SubagentExpandedStyles from '@/features/chat/components/subagents/SubagentExpandedStyles';

describe('SubagentExpandedStyles', () => {
  it('keeps the overlay full-bleed and its timeline scrollable', () => {
    const { container } = render(<SubagentExpandedStyles />);
    const css = container.querySelector('style')?.textContent;

    expect(css).toContain('.subagent-expanded {');
    expect(css).toContain('position: absolute;');
    expect(css).toContain('.subagent-expanded-timeline {');
    expect(css).toContain('overflow-y: auto;');
    expect(css).toContain('.subagent-jump-latest {');
  });
});
