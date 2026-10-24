import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router';
import { ToastProvider } from '../components/ui';
import { useSettings } from '../hooks/use-api';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 5_000 } } });

function ThemeSync() {
  const { data } = useSettings();
  useEffect(() => {
    const theme = data?.theme ?? 'system';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.setAttribute('data-theme', theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [data?.theme]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <HashRouter>
          <ThemeSync />
          {children}
        </HashRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
