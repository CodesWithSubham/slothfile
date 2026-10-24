# Privacy

- **No account, no hosted backend, no telemetry, no automatic upload.**
- **Where data lives:** SQLite database `slothfile.db` in the app data folder (Electron `userData`; Windows: `%APPDATA%\SlothFile`) plus `logs/slothfile.log`. Settings → *Your data* shows exact paths. Installing/uninstalling never writes to the install directory; uninstall keeps user data.
- **Persisted metadata:** selected folder paths, per-file path, name, extension, size, modified time, content hash (only for same-size candidates), classification (category, suggested name, confidence, one-sentence reason, provider, model), plans, operation history (paths, fingerprints, outcomes), jobs, settings. A folder path is recorded when you choose it.
- **Document content:** for AI suggestions only, up to 4000 characters of extracted text from `.txt/.md/.pdf` plus the file name, extension and size are sent to the configured Ollama address for each request. Text is **not stored** and **not logged**.
- **Ollama:** default `http://127.0.0.1:11434` (your computer). A different address is treated as remote and requires explicit consent in Settings; content then leaves your machine to that server. Model downloads (done by Ollama) need internet.
- **Logs:** structured, contain counts, error codes and IDs, not document text or file names; sensitive keys are redacted. They can still contain timing and error categories. Review before sharing.
- **Removing data:** Settings → *Clear local data* (typed confirmation) deletes all SlothFile metadata, history and settings. It never deletes or moves your files, and earlier moves can no longer be undone from SlothFile afterwards. Removing a single folder drops only its records.
- **Unavailable folders:** scans fail with a clear message; files not seen in a *complete* scan are flagged missing, never deleted from disk.
- **Closing during processing:** jobs are cancelled between files; an in-flight move finishes or is reconciled on next launch; interrupted jobs are reported, not resumed.
