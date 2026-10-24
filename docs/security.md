# Security

## Electron hardening
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `webviewTag: false`, strict CSP (`default-src 'self'`; dev adds localhost HMR), navigation blocked (`will-navigate`), `window.open` denied (http/https go to the OS browser), permission requests denied, single-instance lock.

## Threat model
| Threat | Mitigation |
|---|---|
| Malicious document text / prompt injection | Delimited, bounded excerpt; system prompt says classify, never obey; output is only `category` enum + name + number + reason; human review; delimiter-escape handling is unit-tested and a hostile sample is in the labelled dataset (model behaviour itself is only measurable with a real model). Injection can mislabel a file, not execute anything. |
| Model proposes paths/commands | Schema has no path field; extra keys are dropped; names sanitized (separators, control chars, leading dots, reserved names, length, extension forced to the original); destination computed in trusted code. |
| Path traversal / escape | `path.relative` containment + realpath of deepest existing ancestor; stored destination must equal the derived one. |
| Symlinks/junctions | Scanner never follows them; sources must be `lstat` regular files; destination folders that resolve outside scope are rejected (tested). |
| Collisions / overwrite | `link()` fails if destination exists; exclusive copy flag; in-plan duplicate detection (case-folded); revalidation immediately before mutation. |
| File changes during processing | Fingerprint (size, mtime, optional hash) checked at plan, approval-time revalidation and execution; hashing aborts with FILE_CHANGED if the file moves under it. |
| Compromised renderer | Closed API, strict schemas without paths, sender/frame/origin checks, no Node in renderer; execution still needs approved ops + confirmed IDs; worst case is bounded to moves the user could have approved within selected folders. |
| Malformed IPC | Zod `.strict()`, bounded arrays/pages, own-property name check, sanitized errors (tested, incl. in real Electron). |
| Remote Ollama | Default loopback. Non-loopback blocked in the provider until the user enables "Allow remote Ollama"; settings UI warns; redirects are refused. |
| Interrupted moves | Write-ahead journal + reconciliation (tested with injected crashes at each step). |

## Known limitations (honest)
- Check-then-act races cannot be fully eliminated with portable Node APIs. Mitigations: revalidate immediately before mutate, atomic `link` for the destination, verify source unchanged before unlink. A hostile local process with write access to the same folder could still win a narrow race on the rename-fallback path (filesystems without hard links) or replace the source between final check and unlink.
- A power loss exactly between two filesystem calls is handled by reconciliation, but cannot be guaranteed on filesystems that reorder metadata writes.
- PDF parsing happens in the main process. A parser bug could crash the app (observed once with an incompatible pdfjs version). Moves remain safe because of the journal; isolating parsers in a utility process is on the roadmap.
- Timestamps/sizes are not proof of identical content; hashes are used where stored.
- `better-sqlite3` and Electron are not audited by this project; keep dependencies updated.
