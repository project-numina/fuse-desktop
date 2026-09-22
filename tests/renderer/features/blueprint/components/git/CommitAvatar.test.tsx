import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CommitAvatar from '@/features/blueprint/components/git/CommitAvatar';

describe('CommitAvatar', () => {
  it('renders the remote image when supplied', () => {
    render(<CommitAvatar avatarUrl="https://example.test/a.png" actor="Ada" />);
    expect(screen.getByRole('img', { name: 'Ada', hidden: true })).toHaveAttribute(
      'src',
      'https://example.test/a.png',
    );
  });

  it('renders an uppercase initial without a URL', () => {
    const { container } = render(<CommitAvatar avatarUrl={null} actor="ada" />);
    expect(container).toHaveTextContent('A');
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('falls back after an image load error', () => {
    const { container } = render(
      <CommitAvatar avatarUrl="https://example.test/broken.png" actor="Ada" />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Ada', hidden: true }));
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('A');
  });

  it('retries when the URL changes', () => {
    const { rerender } = render(
      <CommitAvatar avatarUrl="https://example.test/broken.png" actor="Ada" />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Ada', hidden: true }));
    rerender(<CommitAvatar avatarUrl="https://example.test/new.png" actor="Ada" />);
    expect(screen.getByRole('img', { name: 'Ada', hidden: true })).toHaveAttribute(
      'src',
      'https://example.test/new.png',
    );
  });
});
