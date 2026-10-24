# Supported files

| Type | Scan/metadata | Duplicates | Text extraction for AI |
|---|---|---|---|
| any regular file | yes | yes (SHA-256) | no |
| `.txt`, `.md` | yes | yes | first ~16 KB read, ≤ 4000 chars sent; binary content rejected |
| `.pdf` | yes | yes | first 5 pages via pdfjs; size limit in Settings (default 20 MB); **no OCR** — scanned PDFs report "no extractable text" |

Symlinks, junctions and special files are listed as skipped, never followed or moved. Other types are classified from name/extension only, with low confidence.
