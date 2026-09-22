import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AppFooter from '@/components/layout/AppFooter';

describe('AppFooter', () => {
  it('renders the local product attribution as a footer', () => {
    render(<AppFooter />);

    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('© 2026 Project Numina');
    expect(footer).not.toHaveTextContent(/terms|privacy/i);
  });

  it('adds caller-provided layout classes', () => {
    render(<AppFooter className="mt-auto test-footer" />);

    expect(screen.getByRole('contentinfo')).toHaveClass('mt-auto', 'test-footer');
  });
});
