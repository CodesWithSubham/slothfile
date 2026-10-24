# Labelled dataset (synthetic)

`samples.json` contains short, invented, non-sensitive documents with the category a human would assign.
It exists so classification quality can be **measured** against a real model, not claimed.

No accuracy number is published for SlothFile. To produce one for your hardware and model:

1. Start Ollama with a model installed.
2. `SLOTHFILE_OLLAMA_SMOKE=1 pnpm vitest run tests/integration/dataset-eval.test.ts`
3. The test prints per-category and overall agreement. The result depends entirely on the model you use.
