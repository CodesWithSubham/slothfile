import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './button';
import { IconButton } from './button';
import { cn } from '../../lib/cn';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean; }

/**
 * Modal dialog: focus moves in, Tab is trapped, Escape and backdrop click close it,
 * the rest of the app is made inert while it is open, and focus returns to the opener.
 */
export function Dialog({ open, onClose, title, description, children, footer, wide }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
    return () => { root?.removeAttribute('inert'); opener?.focus?.(); };
  }, [open]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0] as HTMLElement; const last = items[items.length - 1] as HTMLElement;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1} onKeyDown={onKeyDown}
        className={cn('flex max-h-[88vh] w-full flex-col rounded-lg border border-line bg-surface shadow-pop [animation:sf-pop_.14s_ease-out]', wide ? 'max-w-3xl' : 'max-w-md')}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="font-display text-lg font-semibold">{title}</h2>
            {description && <p id={descId} className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}><X className="size-4" /></IconButton>
        </div>
        <div className="sf-scroll overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export interface ConfirmationDialogProps {
  open: boolean; onCancel: () => void; onConfirm: () => void; title: string; description?: string; children?: ReactNode;
  confirmLabel: string; cancelLabel?: string; danger?: boolean; loading?: boolean;
}
export function ConfirmationDialog({ open, onCancel, onConfirm, title, description, children, confirmLabel, cancelLabel = 'Cancel', danger, loading }: ConfirmationDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} description={description}
      footer={<><Button data-autofocus onClick={onCancel}>{cancelLabel}</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      {children}
    </Dialog>
  );
}
