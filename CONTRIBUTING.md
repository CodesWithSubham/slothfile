# Contributing

1. Read `AGENTS.md` (applies to humans too) and `docs/architecture.md`.
2. `pnpm install && pnpm dev`.
3. Keep changes focused. Add tests (filesystem behaviour → integration tests in temp dirs). Update docs.
4. Before opening a PR: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
5. Use only synthetic files in tests and issues. Never attach personal documents or logs you have not reviewed.
6. Good first areas: extractors (docx), accessibility, themes, provider adapters, file-table performance, recovery diagnostics.

Be kind and constructive in all discussions.
