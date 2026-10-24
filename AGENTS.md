# AGENTS.md — rules for coding agents working on SlothFile

Read `README.md`, `docs/architecture.md` and `docs/security.md` before changing code. Update tests and docs whenever behaviour changes. Do not add features, services or dependencies that were not asked for.

## Architecture and process boundaries
- `src/main` is the only trusted code: filesystem, SQLite, jobs, AI client. `src/preload` exposes a closed API built from `src/shared/contracts/names.ts`. `src/renderer` is untrusted UI. `src/shared` holds types, schemas, errors, contracts (no Node APIs).
- Keep parsing, classification, filesystem mutation, persistence and UI in separate modules. No giant files.
- No backend server, accounts, cloud sync, telemetry, cloud AI.

## IPC rules (security-critical)
- Add a request by: name in `names.ts` → Zod schema in `ipcSchemas` → output in `IpcOutputs` → handler in `ipc/handlers.ts`. The compiler enforces that all four agree.
- Schemas must be `.strict()` and must **never accept filesystem paths**. Pass IDs; look paths up in the main process.
- The preload must import only `contracts/names.ts` (sandboxed preloads cannot load npm packages such as zod).
- Never expose `ipcRenderer`, `fs`, `shell`, DB handles or raw channels to the renderer.

## File-safety invariants (never weaken; tests exist)
1. Destinations are computed by `buildDestinationPath`; model/renderer text is only a category enum + a sanitized bare file name.
2. Never overwrite, never delete user files (the only deletion allowed is a source proven byte-identical to an existing destination, and SlothFile's own `.slothfile-partial-*.tmp`).
3. Revalidate immediately before every mutation. Journal (`operation_history`, status `started`) **before** touching disk; mark `completed` only after success.
4. Undo must refuse if the destination changed/vanished or the original path is occupied.
5. Containment uses `path.relative` + realpath, never string prefixes.
6. No document text or file names in logs or the database.

## TypeScript / style
- Strict TS, no `any`, no unchecked casts at boundaries, `unknown` for untrusted input validated with Zod. Type-only imports where possible. Share types via `src/shared`.
- Tailwind CSS v4, CSS-first tokens in `src/renderer/styles/globals.css`; no `tailwind.config.js`.
- **No UI component library.** Build components in `src/renderer/components/ui` with semantic HTML, keyboard support and visible focus.
- Server data → TanStack Query; UI-only state → Zustand.

## Database
- Add `src/main/database/migrations/NNN-name.ts`, register it in `MIGRATIONS`. Never edit a shipped migration. Repositories own all SQL.

## Validation commands (run before finishing)
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
xvfb-run -a pnpm test:e2e   # Linux; plain `pnpm test:e2e` elsewhere
```
Filesystem tests use temp dirs only. Report real results; never claim checks you did not run.

## Known environment traps
- `pdfjs-dist` must stay on 5.7.x until 6.x is verified in Electron (6.x crashes Electron 45 at import).
- Unset `NODE_OPTIONS` when launching Electron/Playwright if it contains `--use-openssl-ca`.
- `better-sqlite3` is a runtime **dependency** (not dev); bundling it breaks native loading.
