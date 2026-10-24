import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '../../lib/cn';

type Tone = 'success' | 'error' | 'info';
interface Toast { id: number; tone: Tone; message: string; }
interface ToastApi { show: (tone: Tone, message: string) => void; }

const Ctx = createContext<ToastApi | null>(null);
let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setItems((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback((tone: Tone, message: string) => {
    const id = ++counter;
    setItems((t) => [...t.slice(-3), { id, tone, message }]);
    if (tone !== 'error') setTimeout(() => dismiss(id), 5000); // errors stay until dismissed
  }, [dismiss]);
  const api = useMemo(() => ({ show }), [show]);
  const icon = { success: CheckCircle2, error: TriangleAlert, info: Info } as const;
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" role="region" aria-label="Notifications">
        {items.map((t) => {
          const Icon = icon[t.tone];
          return (
            <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
              className={cn('pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface p-3 text-[13px] shadow-pop [animation:sf-pop_.14s_ease-out]', t.tone === 'error' ? 'border-danger' : 'border-line')}>
              <Icon className={cn('mt-0.5 size-4 shrink-0', t.tone === 'success' && 'text-accent', t.tone === 'error' && 'text-danger', t.tone === 'info' && 'text-info')} aria-hidden />
              <p className="flex-1">{t.message}</p>
              <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="text-muted hover:text-ink"><X className="size-4" /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast must be used inside ToastProvider');
  return c;
}
