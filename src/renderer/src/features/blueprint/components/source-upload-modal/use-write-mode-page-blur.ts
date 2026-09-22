import { useCallback, useEffect, useRef } from 'react';

/** Uses a static page blur so editor keystrokes do not resample a backdrop filter. */
export function useWriteModePageBlur(open: boolean, writeMode: boolean) {
  const blurredPageRootRef = useRef<HTMLElement | null>(null);
  const removePageBlur = useCallback(() => {
    const pageRoot = blurredPageRootRef.current;
    if (!pageRoot) return;
    pageRoot.classList.remove('page-behind-dialog-blurred');
    blurredPageRootRef.current = null;
  }, []);

  useEffect(() => {
    // Base UI keeps the portal mounted during its exit animation.
    if (!open) return;
    if (!writeMode) {
      removePageBlur();
      return;
    }
    const pageRoot = document.getElementById('root');
    if (!pageRoot) return;
    pageRoot.classList.add('page-behind-dialog-blurred');
    blurredPageRootRef.current = pageRoot;
  }, [open, writeMode, removePageBlur]);

  // A parent may unmount without waiting for the close transition.
  useEffect(() => removePageBlur, [removePageBlur]);
  return removePageBlur;
}
