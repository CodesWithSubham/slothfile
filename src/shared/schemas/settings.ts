import { z } from 'zod';
import { DEFAULT_EXCLUDED_DIRS, DEFAULT_OLLAMA_URL, SUPPORTED_EXTRACT_EXTENSIONS } from '../constants';

/** Only http(s) URLs. Hostnames other than loopback are flagged as remote in the UI and docs. */
export const OllamaUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'Must be a valid http(s) URL without credentials');

export const SettingsSchema = z.object({
  ollamaUrl: OllamaUrlSchema.default(DEFAULT_OLLAMA_URL),
  /** Explicit consent flag required before document text may be sent to a non-loopback endpoint. */
  allowRemoteOllama: z.boolean().default(false),
  model: z.string().trim().max(200).default(''),
  aiEnabled: z.boolean().default(true),
  extractableExtensions: z.array(z.string().regex(/^\.[a-z0-9]{1,10}$/)).max(50).default([...SUPPORTED_EXTRACT_EXTENSIONS]),
  maxExtractBytes: z.number().int().min(1024).max(200 * 1024 * 1024).default(20 * 1024 * 1024),
  excludedDirs: z.array(z.string().trim().min(1).max(255).refine((s) => !/[\\/]/.test(s), 'Use folder names, not paths')).max(100).default([...DEFAULT_EXCLUDED_DIRS]),
  confidenceThreshold: z.number().min(0).max(1).default(0.6),
  aiConcurrency: z.number().int().min(1).max(4).default(1),
  theme: z.enum(['system', 'light', 'dark']).default('system')
});

export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** Partial update accepted from the renderer. Merged and re-validated in the main process. */
export const SettingsPatchSchema = SettingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}
