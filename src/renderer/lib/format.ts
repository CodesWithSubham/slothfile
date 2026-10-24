export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024; let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}
export const formatDate = (ms: number | null): string => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const shortHash = (h: string | null): string => (h ? h.slice(0, 12) : '—');
export const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '') || p;
