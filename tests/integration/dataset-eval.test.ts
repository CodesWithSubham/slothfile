import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OllamaProvider } from '../../src/main/ai/providers/ollama-provider';
import { sanitizeSuggestedName } from '../../src/main/security/path-policy';

const enabled = process.env.SLOTHFILE_OLLAMA_SMOKE === '1';
interface Sample { fileName: string; extension: string; excerpt: string | null; expected: string }

describe.skipIf(!enabled)('labelled dataset evaluation (real model; prints agreement, asserts only safety)', () => {
  it('measures agreement and never lets a suggestion escape the filename policy', async () => {
    const samples = JSON.parse(readFileSync('tests/labelled-dataset/samples.json', 'utf8')) as Sample[];
    const base = { ollamaUrl: 'http://127.0.0.1:11434', allowRemoteOllama: false, aiEnabled: true, model: '' };
    const models = await new OllamaProvider(() => base).listModels();
    const model = process.env.SLOTHFILE_OLLAMA_MODEL ?? models.find((m) => m.looksLikeGemma)?.name ?? '';
    const p = new OllamaProvider(() => ({ ...base, model }));
    let agree = 0;
    for (const s of samples) {
      const r = await p.classifyFile({ fileName: s.fileName, extension: s.extension, sizeBytes: 100, excerpt: s.excerpt }, { timeoutMs: 180_000 });
      if (r.category === s.expected) agree++;
      console.log(`${s.fileName}: expected ${s.expected}, got ${r.category} (${r.confidence})`);
      const clean = sanitizeSuggestedName(r.suggestedName, s.extension);
      if (clean.ok) expect(clean.name).not.toMatch(/[\\/]/);
    }
    console.log(`Agreement on ${samples.length} synthetic samples with ${model}: ${agree}/${samples.length}`);
  });
});
