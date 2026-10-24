# SlothFile

**Your files organized. Your effort minimized.** *Let AI make the plan. You approve every move.*

SlothFile is a local-first desktop app that helps you sort a cluttered folder (think Downloads). It scans a folder you choose, optionally asks a **local** AI model to suggest a category and a clearer name for each file, shows you a plan, and moves files only after you approve each move. Every move is journaled and can be undone while it is still safe to do so.

> Status: early release (0.1.0). No releases, downloads, screenshots or benchmarks are published yet.

## Principles

1. **Slow and steady**: deliberate scan → review → approve → run workflow.
2. **Local first**: metadata is stored on your computer; AI runs through your own Ollama.
3. **Human controlled**: AI proposes, you decide.
4. **Safe by default**: files are never deleted, never overwritten, and never moved without explicit approval.

## Features

- Folder scanning that never follows symlinks, honours exclusions, reports progress, and can be cancelled.
- Duplicate detection by streaming SHA-256 (only same-size files are hashed). Nothing is deleted or merged automatically.
- Optional AI suggestions (category, filename, confidence, reason) via Ollama; Gemma models recommended. Output is schema-validated and treated as untrusted.
- Reviewable plans: edit names/categories, see conflicts and warnings, approve individually.
- Safe execution: re-validation right before each move, no-overwrite moves, write-ahead journal, crash reconciliation at next launch.
- History with guarded **Undo** (refused if the file changed or the original location is occupied).
- Works **without AI**: scanning, browsing, duplicates, manual plans, execution, history and Undo do not need Ollama.

## Architecture (short)

Electron main process (trusted: filesystem, SQLite, jobs, AI client) ⟷ typed, validated IPC ⟷ sandboxed React renderer (untrusted UI). See [docs/architecture.md](docs/architecture.md).

Stack: Electron, electron-vite, React 19, TypeScript (strict), Tailwind CSS v4, React Router, Zustand, TanStack Query, Zod, better-sqlite3, pdfjs-dist, Pino, Vitest, Testing Library, Playwright, Oxlint, electron-builder. **No third-party UI component library**; all components are in `src/renderer/components/ui`.

## Getting started

Prerequisites: Node.js ≥ 22.12, pnpm 10. (Optional: [Ollama](https://ollama.com).)

```bash
pnpm install
pnpm dev
```

### Optional: local AI with Gemma

```bash
# install Ollama from ollama.com, start it, then pull a model your machine can run
ollama pull gemma3:4b
```

Open **Settings**, press *Check again*, choose the model. Model names change over time; pick any installed model, and check `ollama list`. Models are never bundled and are downloaded by Ollama (needs internet once).

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run in development |
| `pnpm typecheck` | Type-check main/preload/shared and renderer |
| `pnpm lint` | Oxlint |
| `pnpm test` | Unit + integration tests (temp directories only) |
| `pnpm test:e2e` | Playwright against the built app (`pnpm build` first; on Linux use `xvfb-run -a`) |
| `pnpm test:ollama` | Optional real-Ollama smoke test |
| `pnpm build` | Production build |
| `pnpm dist` | Windows x64 installer (run on Windows) |
| `pnpm dist:dir` | Unpacked build for the current OS |

More: [docs/development.md](docs/development.md), [docs/testing.md](docs/testing.md), [docs/troubleshooting.md](docs/troubleshooting.md).

## Privacy and security

No account, no telemetry, no automatic uploads. Document text is sent only to the Ollama address you configure (default: this computer). See [docs/privacy.md](docs/privacy.md) and [docs/security.md](docs/security.md).

## Current limitations

- Text extraction: `.txt`, `.md`, `.pdf` only; scanned PDFs are not OCR'd.
- PDF parsing runs in the main process (a malformed PDF could crash it; the journal makes this safe for files, but see roadmap). `pdfjs-dist` is pinned to 5.7.284 because 6.x crashed Electron 45 at import.
- Windows installer is configured but was **not built or run** by the author's CI sandbox; Linux unpacked build was smoke-tested. macOS untested.
- Exact-hash duplicates only (no near-duplicate detection).
- File moves are not transactional across a power loss at the worst instant; the journal and reconciliation minimise but cannot eliminate that (see security doc).
- Classification quality depends entirely on your model; no accuracy figure is claimed.

## Roadmap ideas

Isolate parsers in a utility process, more extractors (docx), OCR (opt-in), additional providers, near-duplicate detection, virtualized file table, macOS/Linux packaging.

## Contributing / License

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). MIT licensed.
