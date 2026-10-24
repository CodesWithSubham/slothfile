import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { isLoopbackUrl, type Settings } from '@shared/schemas/settings';
import { Badge, Button, Card, ConfirmationDialog, ErrorState, Field, Input, LoadingState, PageHeader, Select, Switch } from '../../components/ui';
import { useAiStatus, useApiMutation, useAppInfo, useSettings } from '../../hooks/use-api';
import { api } from '../../lib/api';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <Card className="mb-5 p-5"><h2 className="font-display text-lg font-semibold">{title}</h2>{description && <p className="mb-4 mt-0.5 text-[13px] text-muted">{description}</p>}<div className="space-y-4">{children}</div></Card>;
}

export function SettingsPage() {
  const settings = useSettings();
  const ai = useAiStatus();
  const info = useAppInfo();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [excluded, setExcluded] = useState('');
  const [extensions, setExtensions] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (settings.data && !draft) { setDraft(settings.data); setExcluded(settings.data.excludedDirs.join(', ')); setExtensions(settings.data.extractableExtensions.join(', ')); } }, [settings.data, draft]);

  const save = useApiMutation((s: Partial<Settings>) => api()['settings.update'](s), { success: 'Settings saved.', onSuccess: (s) => { setDraft(s); setError(null); void ai.refetch(); } });
  const clear = useApiMutation(() => api()['data.clear']({ confirm: 'CLEAR LOCAL DATA' }), { success: 'SlothFile’s local data was cleared. Your files were not touched.', onSuccess: () => { setClearOpen(false); setConfirmText(''); setDraft(null); } });

  if (settings.isLoading || !draft) return <LoadingState label="Loading settings" />;
  if (settings.error) return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft({ ...draft, [k]: v });
  const remote = !isLoopbackUrl(draft.ollamaUrl);
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const models = ai.data?.models ?? [];

  const submit = () => {
    save.mutate({ ...draft, excludedDirs: list(excluded), extractableExtensions: list(extensions).map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase()) }, );
  };

  return (
    <>
      <PageHeader title="Settings" actions={<Button variant="primary" loading={save.isPending} onClick={submit}>Save changes</Button>} />
      {error && <ErrorState message={error} />}

      <Section title="AI suggestions (optional)" description="SlothFile works fully without AI. When enabled, it asks a local Ollama model to suggest categories and names; you still approve every move.">
        <div className="flex items-center justify-between"><span className="text-[13px] font-medium">Use AI suggestions</span><Switch label="Use AI suggestions" checked={draft.aiEnabled} onChange={(v) => set('aiEnabled', v)} /></div>
        <Field label="Ollama address" hint="Default is on this computer. Document excerpts are sent to this address for classification.">
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={draft.ollamaUrl} onChange={(e) => set('ollamaUrl', e.target.value)} />}
        </Field>
        {remote && (
          <div className="rounded-md border border-warn/50 bg-warn-soft p-3 text-[13px]">
            <p className="font-medium text-warn">This address is not on this computer</p>
            <p className="mt-1">Short excerpts of your documents would be sent over the network to that server. Only enable this if you trust and control it.</p>
            <div className="mt-2 flex items-center gap-2"><Switch label="Allow remote Ollama" checked={draft.allowRemoteOllama} onChange={(v) => set('allowRemoteOllama', v)} /><span>Allow sending document text to this address</span></div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label="Model" hint="Gemma models are recommended; any installed Ollama model can be chosen.">
            {(p) => <Select id={p.id} aria-describedby={p.describedBy} value={draft.model} onChange={(e) => set('model', e.target.value)}>
              <option value="">Select a model…</option>
              {models.map((m) => <option key={m.name} value={m.name}>{m.name}{m.looksLikeGemma ? ' (Gemma)' : ''}</option>)}
              {draft.model && !models.some((m) => m.name === draft.model) && <option value={draft.model}>{draft.model} (not installed)</option>}
            </Select>}</Field></div>
          <Button icon={<RefreshCw className="size-4" />} onClick={() => void ai.refetch()} loading={ai.isFetching}>Check again</Button>
        </div>
        <p className="text-[13px]" aria-live="polite"><Badge tone={ai.data?.state === 'ready' ? 'accent' : 'warn'}>{ai.data?.state ?? 'checking'}</Badge> <span className="text-muted">{ai.data?.message}</span></p>
        {ai.data && ai.data.state !== 'ready' && (
          <details className="text-[13px] text-muted"><summary className="cursor-pointer font-medium text-ink">How to set up local AI</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5"><li>Install Ollama from ollama.com and start it.</li><li>Download a Gemma model in a terminal, e.g. <code className="font-mono">ollama pull gemma3:4b</code>. Pick a size your computer can run; smaller models are faster but less accurate.</li><li>Return here, press “Check again”, and select the model.</li></ol>
            <p className="mt-2">Models are downloaded by Ollama, not bundled with SlothFile, and downloading needs an internet connection. Classification afterwards runs on your computer.</p>
          </details>
        )}
        <Field label="Parallel AI requests" hint="Lower is gentler on modest hardware (1–4).">{(p) => <Input id={p.id} type="number" min={1} max={4} value={draft.aiConcurrency} onChange={(e) => set('aiConcurrency', Number(e.target.value))} className="w-24" />}</Field>
        <Field label="Low-confidence threshold" hint="Suggestions below this are flagged and excluded from “Approve all safe” (0–1).">{(p) => <Input id={p.id} type="number" step="0.05" min={0} max={1} value={draft.confidenceThreshold} onChange={(e) => set('confidenceThreshold', Number(e.target.value))} className="w-24" />}</Field>
      </Section>

      <Section title="Scanning & text extraction">
        <Field label="Excluded folder names" hint="Comma-separated names (not paths). Folders with these names are skipped everywhere.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={excluded} onChange={(e) => setExcluded(e.target.value)} />}</Field>
        <Field label="File types to read text from" hint="Supported: .txt, .md, .pdf. Scanned PDFs have no text and are not OCR’d.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={extensions} onChange={(e) => setExtensions(e.target.value)} />}</Field>
        <Field label="Maximum file size for text extraction (MB)">{(p) => <Input id={p.id} type="number" min={1} max={200} value={Math.round(draft.maxExtractBytes / 1048576)} onChange={(e) => set('maxExtractBytes', Math.round(Number(e.target.value) * 1048576))} className="w-28" />}</Field>
      </Section>

      <Section title="Appearance">
        <Field label="Theme">{(p) => <Select id={p.id} value={draft.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])} className="w-48"><option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option></Select>}</Field>
      </Section>

      <Section title="Your data" description="Everything SlothFile remembers is stored on this computer. No account, no telemetry, no uploads.">
        <dl className="grid grid-cols-[120px_1fr] gap-2 text-[13px]"><dt className="text-muted">Database folder</dt><dd className="break-all font-mono text-xs">{info.data?.dataDir}</dd><dt className="text-muted">Log folder</dt><dd className="break-all font-mono text-xs">{info.data?.logDir}</dd></dl>
        <p className="text-[13px] text-muted">Clearing local data removes SlothFile’s scan results, plans, history and settings. It never deletes or moves your files; it also means earlier moves can no longer be undone from here.</p>
        <Button variant="danger" onClick={() => setClearOpen(true)}>Clear local data…</Button>
      </Section>

      <ConfirmationDialog open={clearOpen} onCancel={() => { setClearOpen(false); setConfirmText(''); }} onConfirm={() => { if (confirmText === 'CLEAR') clear.mutate(undefined); }} loading={clear.isPending} danger confirmLabel="Clear local data"
        title="Clear SlothFile’s local data?" description="Your files are not affected.">
        <Field label="Type CLEAR to confirm">{(p) => <Input id={p.id} data-autofocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />}</Field>
        {confirmText !== 'CLEAR' && <p className="mt-2 text-xs text-muted">Nothing happens until you type CLEAR exactly.</p>}
      </ConfirmationDialog>
    </>
  );
}
