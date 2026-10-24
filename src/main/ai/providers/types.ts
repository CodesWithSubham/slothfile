import type { FileClassification } from '@shared/schemas/classification';
import type { ClassifyPromptInput } from '../prompts/classify';

export interface AIModelInfo { name: string; sizeBytes: number | null; looksLikeGemma: boolean; }

export type AIStatusState = 'ready' | 'disabled' | 'unreachable' | 'no-model' | 'model-missing';
export interface AIProviderStatus {
  state: AIStatusState;
  /** Actionable explanation for the UI. */
  message: string;
  models: AIModelInfo[];
  selectedModel: string | null;
  isRemote: boolean;
}

export interface ClassificationOptions { signal?: AbortSignal; timeoutMs?: number; }

export interface AIProvider {
  readonly id: string;
  getStatus(): Promise<AIProviderStatus>;
  listModels(): Promise<AIModelInfo[]>;
  classifyFile(input: ClassifyPromptInput, options?: ClassificationOptions): Promise<FileClassification>;
}
