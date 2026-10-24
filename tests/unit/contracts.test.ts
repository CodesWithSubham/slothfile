import { describe, expect, it } from 'vitest';
import { IPC_NAMES, ipcSchemas } from '../../src/shared/contracts';
import { isTrustedUrl } from '../../src/main/ipc/sender-policy';
import { SettingsSchema, SettingsPatchSchema, isLoopbackUrl } from '../../src/shared/schemas/settings';

describe('IPC contract', () => {
  it('names and schemas match exactly', () => {
    expect([...IPC_NAMES].sort()).toEqual(Object.keys(ipcSchemas).sort());
  });
  it('no schema accepts an arbitrary filesystem path field', () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(ipcSchemas['scan.start'].safeParse({ folderId: uuid, path: '/etc' }).success).toBe(false);
    expect(ipcSchemas['scan.start'].safeParse({ folderId: '/etc/passwd' }).success).toBe(false);
    expect(ipcSchemas['plans.edit'].safeParse({ operationId: uuid, destinationPath: '/tmp/x' }).success).toBe(false);
    expect(ipcSchemas['plans.edit'].safeParse({ operationId: uuid, category: 'weapons' }).success).toBe(false);
    expect(ipcSchemas['plans.edit'].safeParse({ operationId: uuid, category: 'finance', fileName: 'a.pdf' }).success).toBe(true);
  });
  it('bounds list sizes and pagination', () => {
    expect(ipcSchemas['files.list'].safeParse({ limit: 100000, offset: 0 }).success).toBe(false);
    expect(ipcSchemas['files.list'].safeParse({ limit: 50, offset: -1 }).success).toBe(false);
  });
  it('requires an exact confirmation phrase to clear data', () => {
    expect(ipcSchemas['data.clear'].safeParse({ confirm: 'yes' }).success).toBe(false);
    expect(ipcSchemas['data.clear'].safeParse({ confirm: 'CLEAR LOCAL DATA' }).success).toBe(true);
  });
});

describe('sender policy', () => {
  it('accepts only the bundled renderer in production', () => {
    const o = { isDev: false };
    expect(isTrustedUrl('file:///C:/Program%20Files/SlothFile/resources/app.asar/out/renderer/index.html', o)).toBe(true);
    expect(isTrustedUrl('https://evil.example/renderer/index.html', o)).toBe(false);
    expect(isTrustedUrl('file:///tmp/evil.html', o)).toBe(false);
    expect(isTrustedUrl('not a url', o)).toBe(false);
  });
  it('accepts only the dev server origin in dev', () => {
    const o = { isDev: true, devUrl: 'http://localhost:5173' };
    expect(isTrustedUrl('http://localhost:5173/#/files', o)).toBe(true);
    expect(isTrustedUrl('http://localhost:5174/', o)).toBe(false);
  });
});

describe('settings validation', () => {
  it('has safe defaults', () => {
    const s = SettingsSchema.parse({});
    expect(s.ollamaUrl).toBe('http://127.0.0.1:11434');
    expect(s.allowRemoteOllama).toBe(false);
    expect(s.aiConcurrency).toBe(1);
  });
  it('rejects bad values', () => {
    expect(SettingsPatchSchema.safeParse({ ollamaUrl: 'ftp://x' }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ ollamaUrl: 'http://user:pw@host' }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ aiConcurrency: 50 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ excludedDirs: ['a/b'] }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ unknownKey: 1 }).success).toBe(false);
  });
  it('detects loopback addresses', () => {
    expect(isLoopbackUrl('http://localhost:11434')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:11434')).toBe(true);
    expect(isLoopbackUrl('http://192.168.0.5:11434')).toBe(false);
    expect(isLoopbackUrl('http://localhost.evil.com')).toBe(false);
  });
});
