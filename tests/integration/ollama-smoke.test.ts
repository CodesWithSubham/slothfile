import { describe, expect, it } from 'vitest';
import { OllamaProvider } from '../../src/main/ai/providers/ollama-provider';

// Optional: only runs with SLOTHFILE_OLLAMA_SMOKE=1 and a real Ollama + model.
// SLOTHFILE_OLLAMA_MODEL selects the model (default: first installed Gemma model).
const enabled = process.env.SLOTHFILE_OLLAMA_SMOKE === '1';

describe.skipIf(!enabled)('real Ollama smoke test', () => {
  it('classifies a synthetic document into a schema-valid result', async () => {
    const base = { ollamaUrl: process.env.SLOTHFILE_OLLAMA_URL ?? 'http://127.0.0.1:11434', allowRemoteOllama: false, aiEnabled: true, model: '' };
    const probe = new OllamaProvider(() => base);
    const models = await probe.listModels();
    const model = process.env.SLOTHFILE_OLLAMA_MODEL ?? models.find((m) => m.looksLikeGemma)?.name;
    expect(model, 'no Gemma model installed; set SLOTHFILE_OLLAMA_MODEL').toBeTruthy();
    const p = new OllamaProvider(() => ({ ...base, model: model as string }));
    const r = await p.classifyFile({ fileName: 'random-name-01.txt', extension: '.txt', sizeBytes: 120, excerpt: 'Lecture 5: graph traversal, BFS and DFS. Semester 5 data structures course notes.' }, { timeoutMs: 180_000 });
    expect(['education', 'documents', 'other']).toContain(r.category);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
  });
});
