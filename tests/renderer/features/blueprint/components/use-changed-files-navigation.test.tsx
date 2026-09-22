import { useChangedFilesNavigation } from '@/features/blueprint/components/use-changed-files-navigation';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

function Harness({
  rootPath,
  selectedFile,
  onDirectoryChange,
}: {
  rootPath: string;
  selectedFile: string | null;
  onDirectoryChange: (path: string) => void;
}) {
  const navigation = useChangedFilesNavigation({ rootPath, selectedFile, onDirectoryChange });
  return (
    <div>
      <span data-testid="path">{navigation.currentPath}</span>
      <span data-testid="breadcrumbs">{navigation.breadcrumbs.map((item) => item.name).join('/')}</span>
      <button type="button" onClick={() => navigation.enterFolder(`${navigation.treeRoot}/Foo`)}>enter</button>
      <button type="button" onClick={navigation.goUp}>up</button>
      <button type="button" onClick={navigation.goHome}>home</button>
    </div>
  );
}

describe('useChangedFilesNavigation', () => {
  it('navigates within the root and keeps the browsed folder when selection clears', () => {
    const onDirectoryChange = vi.fn();
    const props = { rootPath: 'lean/project', selectedFile: null, onDirectoryChange };
    const view = render(<Harness {...props} />);
    expect(screen.getByTestId('path')).toHaveTextContent('lean/project');
    expect(onDirectoryChange).toHaveBeenLastCalledWith('lean/project');

    fireEvent.click(screen.getByRole('button', { name: 'enter' }));
    expect(screen.getByTestId('path')).toHaveTextContent('lean/project/Foo');
    expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('Foo');
    view.rerender(<Harness {...props} selectedFile="lean/project/Foo/Main.lean" />);
    view.rerender(<Harness {...props} selectedFile={null} />);
    expect(screen.getByTestId('path')).toHaveTextContent('lean/project/Foo');

    fireEvent.click(screen.getByRole('button', { name: 'up' }));
    expect(screen.getByTestId('path')).toHaveTextContent('lean/project');
  });

  it('resets out-of-root selections and root changes to the visible root', () => {
    const onDirectoryChange = vi.fn();
    const view = render(
      <Harness rootPath="lean/project" selectedFile={null} onDirectoryChange={onDirectoryChange} />,
    );
    view.rerender(
      <Harness rootPath="lean/project" selectedFile="other/Main.lean" onDirectoryChange={onDirectoryChange} />,
    );
    expect(screen.getByTestId('path')).toHaveTextContent('lean/project');
    view.rerender(
      <Harness rootPath="lean/next" selectedFile={null} onDirectoryChange={onDirectoryChange} />,
    );
    expect(screen.getByTestId('path')).toHaveTextContent('lean/next');
  });
});
