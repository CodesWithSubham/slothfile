# Development

```bash
pnpm install          # Node >= 22.12, pnpm 10
pnpm dev              # electron-vite dev server + Electron
pnpm typecheck        # tsc for main/preload/shared + renderer
pnpm lint             # oxlint
pnpm test             # vitest (unit + integration)
pnpm build            # production bundles in out/
pnpm test:e2e         # needs pnpm build; Linux: xvfb-run -a pnpm test:e2e
pnpm dist:dir         # unpacked packaged app in release/
pnpm dist             # Windows x64 NSIS installer (run on Windows)
pnpm check:env        # Node version + whether Ollama answers
```

## Native SQLite
`better-sqlite3` 13 ships N-API prebuilds (including win32-x64); no compiler is normally needed, and `electron-builder.yml` sets `npmRebuild: false`. If install tries to compile and fails behind a proxy, supply headers (`npm_config_nodedir=/path/to/node`). The same prebuilt works for Node (tests) and Electron.

## Connect Ollama
Install Ollama, `ollama pull <model>` (a Gemma model is recommended; check `ollama list`), then Settings → *Check again* → pick the model. Optional smoke test: `SLOTHFILE_OLLAMA_SMOKE=1 pnpm test:ollama`. Dataset evaluation: see `tests/labelled-dataset/README.md`.

## Environment notes
- If `NODE_OPTIONS` contains `--use-openssl-ca`, Electron refuses to start: run with `env -u NODE_OPTIONS`.
- `pdfjs-dist` is pinned to 5.7.284 (6.x crashed Electron 45 at import). Upgrade only after running the e2e suite.
