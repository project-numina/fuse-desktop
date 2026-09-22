import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CodeEditor } from '@/components/editor/CodeEditor';

describe('CodeEditor', () => {
  it('renders placeholder text for an empty document', () => {
    render(
      <CodeEditor
        value=""
        placeholder="Paste LaTeX here"
        showLineNumbers={false}
      />,
    );

    expect(screen.getByText('Paste LaTeX here')).toHaveClass('cm-placeholder');
  });
});
