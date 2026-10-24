import { z } from 'zod';
import { AppError } from '@shared/errors';
import { FILE_CLASSIFICATION_JSON_SCHEMA, FileClassificationSchema, type FileClassification } from '@shared/schemas/classification';
import { isLoopbackUrl, type Settings } from '@shared/schemas/settings';
import { SYSTEM_PROMPT, buildUserPrompt, type ClassifyPromptInput } from '../prompts/classify';
import type { AIModelInfo, AIProvider, AIProviderStatus, ClassificationOptions } from './types';

const TagsSchema = z.object({ models: z.array(z.object({ name: z.string(), size: z.number().optional() })) });
const ChatSchema = z.object({ message: z.object({ content: z.string() }) });

type Fetch = typeof fetch;
type Cfg = Pick<Settings, 'ollamaUrl' | 'allowRemoteOllama' | 'model' | 'aiEnabled'>;

const DEFAULT_TIMEOUT_MS = 120_000; // first request may include model load time
const MAX_ATTEMPTS = 2; // one retry, only for invalid/empty output

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama';
  constructor(private readonly getConfig: () => Cfg, private readonly fetchImpl: Fetch = fetch) {}

  private base(): string { return this.getConfig().ollamaUrl.replace(/\/+$/, ''); }

  private assertAllowed(): void {
    const c = this.getConfig();
    if (!isLoopbackUrl(c.ollamaUrl) && !c.allowRemoteOllama) {
      throw new AppError('MODEL_UNAVAILABLE', 'The Ollama address is not on this computer. Enable "Allow remote Ollama" in Settings to confirm you want document text sent there.');
    }
  }

  private async request(pathname: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    this.assertAllowed();
    const timeout = AbortSignal.timeout(timeoutMs);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await this.fetchImpl(`${this.base()}${pathname}`, { ...init, signal: sig, redirect: 'error' });
    } catch (e) {
      if (signal?.aborted) throw new AppError('JOB_CANCELLED', 'Classification was cancelled.');
      if (timeout.aborted) throw new AppError('MODEL_TIMEOUT', 'The model took too long to respond. Try a smaller model or lower the concurrency in Settings.');
      throw new AppError('MODEL_UNAVAILABLE', 'Could not reach Ollama. Is it installed and running?', undefined, { cause: e });
    }
  }

  async listModels(): Promise<AIModelInfo[]> {
    const res = await this.request('/api/tags', { method: 'GET' }, 5000);
    if (!res.ok) throw new AppError('MODEL_UNAVAILABLE', `Ollama answered with an error (HTTP ${res.status}).`);
    const parsed = TagsSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new AppError('MODEL_UNAVAILABLE', 'Ollama returned an unexpected model list.');
    return parsed.data.models.map((m) => ({ name: m.name, sizeBytes: m.size ?? null, looksLikeGemma: /gemma/i.test(m.name) }));
  }

  async getStatus(): Promise<AIProviderStatus> {
    const c = this.getConfig();
    const remote = !isLoopbackUrl(c.ollamaUrl);
    if (!c.aiEnabled) return { state: 'disabled', message: 'AI suggestions are turned off. Everything else works normally.', models: [], selectedModel: null, isRemote: remote };
    let models: AIModelInfo[];
    try {
      models = await this.listModels();
    } catch (e) {
      const msg = e instanceof AppError ? e.message : 'Could not reach Ollama.';
      return { state: 'unreachable', message: `${msg} Install Ollama from ollama.com and start it, or continue without AI.`, models: [], selectedModel: null, isRemote: remote };
    }
    if (models.length === 0) return { state: 'no-model', message: 'Ollama is running but no models are installed. Run "ollama pull <a Gemma model>" and refresh.', models, selectedModel: null, isRemote: remote };
    if (!c.model) {
      const g = models.find((m) => m.looksLikeGemma);
      return { state: 'model-missing', message: g ? `Choose a model in Settings (a Gemma model, ${g.name}, is available).` : 'Choose a model in Settings. No Gemma model is installed; "ollama pull" one to use the recommended model.', models, selectedModel: null, isRemote: remote };
    }
    if (!models.some((m) => m.name === c.model)) return { state: 'model-missing', message: `The model "${c.model}" is not installed in Ollama. Pick an installed model or pull it.`, models, selectedModel: c.model, isRemote: remote };
    return { state: 'ready', message: 'Ready.', models, selectedModel: c.model, isRemote: remote };
  }

  async classifyFile(input: ClassifyPromptInput, options: ClassificationOptions = {}): Promise<FileClassification> {
    const c = this.getConfig();
    if (!c.aiEnabled) throw new AppError('MODEL_UNAVAILABLE', 'AI suggestions are turned off in Settings.');
    if (!c.model) throw new AppError('MODEL_UNAVAILABLE', 'No model is selected. Choose one in Settings.');
    const body = JSON.stringify({
      model: c.model, stream: false, format: FILE_CLASSIFICATION_JSON_SCHEMA, options: { temperature: 0 },
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserPrompt(input) }]
    });
    let lastProblem = 'The model returned no usable answer.';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await this.request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal);
      if (res.status === 404) throw new AppError('MODEL_UNAVAILABLE', `The model "${c.model}" is not installed in Ollama.`);
      if (!res.ok) throw new AppError('MODEL_UNAVAILABLE', `Ollama answered with an error (HTTP ${res.status}).`);
      const chat = ChatSchema.safeParse(await res.json().catch(() => null));
      if (!chat.success || chat.data.message.content.trim() === '') { lastProblem = 'The model returned an empty answer.'; continue; }
      let json: unknown;
      try { json = JSON.parse(chat.data.message.content); } catch { lastProblem = 'The model did not return valid JSON.'; continue; }
      const parsed = FileClassificationSchema.safeParse(json);
      if (parsed.success) return parsed.data;
      lastProblem = 'The model answer did not match the expected format.';
    }
    throw new AppError('INVALID_AI_RESPONSE', lastProblem);
  }
}
