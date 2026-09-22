import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  clearFolderActionErrorOnLeave,
  folderActionErrorMessage,
  OPEN_FOLDER_FALLBACK,
  setFolderActionError,
  useFolderActionError,
} from '@/state/folder-actions';

describe('folder-action error store', () => {
  beforeEach(() => setFolderActionError(null));

  it('publishes the current message to subscribers', () => {
    const { result } = renderHook(() => useFolderActionError());
    expect(result.current).toBeNull();
    act(() => setFolderActionError('Folder not found: /nope'));
    expect(result.current).toBe('Folder not found: /nope');
    act(() => setFolderActionError(null));
    expect(result.current).toBeNull();
  });

  it('keeps the backend detail for API errors and falls back otherwise', () => {
    expect(folderActionErrorMessage(new ApiError('Folder not found: /x', 404), OPEN_FOLDER_FALLBACK)).toBe('Folder not found: /x');
    expect(folderActionErrorMessage(new TypeError('ipc broke'), OPEN_FOLDER_FALLBACK)).toBe(OPEN_FOLDER_FALLBACK);
  });

  // The message belongs to the dashboard: arriving there keeps it (a menu
  // failure navigates to `/` after recording it); leaving drops it.
  it('is dropped on navigation away from the dashboard only', () => {
    setFolderActionError('Folder not found: /nope');
    clearFolderActionErrorOnLeave('/');
    expect(renderHook(() => useFolderActionError()).result.current).toBe('Folder not found: /nope');
    clearFolderActionErrorOnLeave('/chats');
    expect(renderHook(() => useFolderActionError()).result.current).toBeNull();
  });
});
