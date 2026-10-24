# Testing

- **Unit/integration (Vitest):** path policy, filename sanitization, contracts and sender policy, settings, job state machine, AI provider (mocked `fetch`: success, bad JSON, schema violation, timeout, disconnect, cancel, empty, unexpected category, remote refusal, injection delimiter handling), extractors (real PDF fixture, malformed, no-text, oversize), scanner (nested, exclusions, symlinks, cancellation, vanishing files), hashing, repositories/migrations, plan flow, `safeMove` (conflict, changed source, crash after publish), execution, Undo (success, occupied original, modified file, missing file, double undo), recovery at each crash point, and full startup recovery.
- **Component tests (Testing Library, jsdom):** dialog focus trap/Escape/restore, menu keyboard, switch, confidence indicator, empty/error states, pagination, toast.
- **E2E (Playwright + real Electron):** primary workflow with a deterministic fake Ollama HTTP server; no-Ollama startup; renderer isolation and rejection of path-bearing requests.
- **Optional:** `pnpm test:ollama` and the labelled dataset evaluation need a real Ollama and are skipped otherwise. No accuracy figure is claimed.
- All filesystem tests use temp directories removed after each test.

Not covered automatically: Windows-specific paths/reserved names beyond unit logic, packaged Windows installer, macOS, cross-filesystem copy fallback (logic present, exercised only by reasoning), permission-denied scenarios when running as root.
