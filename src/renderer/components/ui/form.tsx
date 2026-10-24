import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/cn';

const field = 'h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 disabled:opacity-60 aria-[invalid=true]:border-danger';

export interface FieldProps { label: string; hint?: string; error?: string | null; children: (p: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode; }
/** Wires a visible label, hint and error message to a control through ids. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium">{label}</label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(field, className)} {...rest} />;
});

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> { label: string; }
export function SearchInput({ label, className, ...rest }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input type="search" aria-label={label} className={cn(field, 'pl-8')} {...rest} />
    </div>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> { label?: string; }
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, className, ...rest }, ref) {
  const input = <input ref={ref} type="checkbox" aria-label={label} className={cn('size-4 cursor-pointer rounded border-line accent-[var(--sf-accent)]', className)} {...rest} />;
  return input;
});

export interface SwitchProps { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; }
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line transition-colors disabled:opacity-50', checked ? 'bg-accent' : 'bg-surface-2')}>
      <span className={cn('inline-block size-3.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-[3px]')} />
    </button>
  );
}

/** Native <select>: full keyboard and screen-reader support for free, styled to match. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={cn(field, 'pr-8', className)} {...rest}>{children}</select>;
});
