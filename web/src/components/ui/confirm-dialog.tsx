"use client";

import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type SyntheticEvent } from "react";

import { Button } from "./button";

export interface ConfirmDialogProps {
  /** Controlled. The parent owns the state and closes the dialog from `onConfirm` and `onCancel`. */
  open: boolean;
  title: string;
  /** What will happen. Wired to the dialog with `aria-describedby`. */
  description?: ReactNode;
  /** Extra content under the description, for example a password field. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Use "danger" for an action that cannot be undone. */
  tone?: "primary" | "danger";
  /** Shows the confirm button as working and keeps the dialog open. */
  busy?: boolean;
  onConfirm: () => void;
  /** Called for the cancel button, the Escape key, and a click outside the dialog. */
  onCancel: () => void;
}

/**
 * A modal confirmation on the native dialog element, so the browser provides the focus trap, the
 * Escape key, and the inert background. Focus starts on the first control inside (a field passed
 * as `children`, otherwise the cancel button) and returns to the element that opened the dialog
 * when it closes.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Close the native dialog if the component unmounts while it is open.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  const restoreFocus = () => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) {
      opener.focus();
    }
  };

  const handleEscape = (event: SyntheticEvent<HTMLDialogElement>) => {
    // Keep the dialog under the parent's control: report the request instead of closing directly.
    event.preventDefault();
    if (!busy) {
      onCancel();
    }
  };

  const handleBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget && !busy) {
      onCancel();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={handleEscape}
      onClose={restoreFocus}
      onClick={handleBackdrop}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] max-w-none rounded-xl border border-edge bg-surface p-0 text-ink backdrop:bg-ground/80"
    >
      <div className="grid gap-4 p-5 sm:p-6">
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {description ? (
          <div id={descriptionId} className="text-sm text-muted">
            {description}
          </div>
        ) : null}
        {children}
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
