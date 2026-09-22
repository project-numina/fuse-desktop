import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import HiddenFilesNotice from '@/features/blueprint/components/git/HiddenFilesNotice';

it('exposes the hidden count and explanation to keyboard users', () => {
  render(<HiddenFilesNotice count={3} tooltip="Generated metadata is hidden." />);
  expect(screen.getByText(/3 hidden/)).toBeInTheDocument();
  expect(screen.getByLabelText('Why are files hidden?')).toHaveAttribute('tabindex', '0');
  expect(screen.getByText('Generated metadata is hidden.')).toBeInTheDocument();
});
