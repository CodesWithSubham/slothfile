export type ClassValue = string | false | null | undefined;
export const cn = (...v: ClassValue[]): string => v.filter(Boolean).join(' ');
