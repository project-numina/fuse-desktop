import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Confirmation modal shared across the blueprint modes.
 *
 * Fully controlled: the parent owns `open` and is notified via `onCancel`
 * (dismiss: overlay click, Escape, or the cancel button) and `onConfirm` (the
 * confirm button). Both dismissal and confirmation are suppressed while `busy`
 * is true so an in-flight action cannot be double-submitted or torn down.
 *
 * `busy` swaps the confirm label for "Working…" and disables both buttons.
 */
export interface ConfirmDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Heading text. Defaults to "Are you sure?". */
  title?: string;
  /** Optional body copy. When empty, no description paragraph renders. */
  message?: string;
  /** Confirm button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Render the confirm button in the destructive (red) treatment. */
  destructive?: boolean;
  /** Disable both buttons and show "Working…" while the action runs. */
  busy?: boolean;
  /** Invoked when the user confirms. */
  onConfirm: () => void;
  /** Invoked when the user dismisses (overlay/Escape/cancel button). */
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Guard dismissal while the action is in flight.
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} role="alertdialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {message && <DialogDescription>{message}</DialogDescription>}
        </DialogHeader>
        {/*
         * The primitive's default footer is a full-bleed muted bar. No other
         * dialog in the app uses it, so strip it back to the plain right-aligned
         * action row the rest of the dialogs share.
         */}
        <DialogFooter className="mx-0 mb-0 flex-row justify-end border-0 bg-transparent p-0 pt-1">
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() => {
              if (!busy) onConfirm();
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmDialog;
