import { open } from 'node:fs/promises';
import { AppError, mapFsError } from '@shared/errors';

export interface ExtractionResult {
  text: string;
  truncated: boolean;
  /** Plain statement of what happened; never claims OCR. */
  note?: string;
}

export interface ExtractOptions {
  maxFileBytes: number;
  maxChars: number;
  signal?: AbortSignal;
}

export const DEFAULT_MAX_CHARS = 4000;

/** Reads at most `limit` bytes. Large files are never read whole. */
async function readHead(filePath: string, limit: number): Promise<{ buf: Buffer; fileSize: number }> {
  let fh;
  try {
    fh = await open(filePath, 'r');
    const st = await fh.stat();
    const buf = Buffer.alloc(Math.min(limit, st.size));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return { buf: buf.subarray(0, bytesRead), fileSize: st.size };
  } catch (e) {
    throw mapFsError(e, 'Reading file');
  } finally {
    await fh?.close();
  }
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0) bad++;
  return bad > 0;
}

export async function extractPlainText(filePath: string, o: ExtractOptions): Promise<ExtractionResult> {
  const { buf, fileSize } = await readHead(filePath, Math.min(o.maxFileBytes, o.maxChars * 4));
  if (looksBinary(buf)) throw new AppError('EXTRACTION_FAILED', 'The file does not look like text.');
  const text = buf.toString('utf8').replace(/�/g, '').replace(/\s+/g, ' ').trim();
  return { text: text.slice(0, o.maxChars), truncated: fileSize > buf.length || text.length > o.maxChars };
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfJs> | null = null;

/**
 * PDF text via pdfjs-dist. Only the first pages are read; if there is no text layer (scanned PDF)
 * the result is an explicit "no text" error. OCR is NOT performed.
 */
export async function extractPdfText(filePath: string, o: ExtractOptions): Promise<ExtractionResult> {
  const { fileSize } = await readHead(filePath, 0);
  if (fileSize > o.maxFileBytes) throw new AppError('EXTRACTION_FAILED', 'The PDF is larger than the extraction size limit in Settings.');
  const { readFile } = await import('node:fs/promises');
  const data = new Uint8Array(await readFile(filePath));
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  const lib = await pdfjs;
  const task = lib.getDocument({ data, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => undefined);
    throw new AppError('EXTRACTION_FAILED', 'The PDF could not be read (it may be damaged or password-protected).', undefined, { cause: e });
  }
  try {
    let text = '';
    const pages = Math.min(doc.numPages, 5);
    for (let i = 1; i <= pages && text.length < o.maxChars; i++) {
      if (o.signal?.aborted) throw new AppError('JOB_CANCELLED', 'Extraction was cancelled.');
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + ' ';
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) throw new AppError('EXTRACTION_FAILED', 'No extractable text found. This may be a scanned PDF; OCR is not supported.');
    return { text: text.slice(0, o.maxChars), truncated: text.length > o.maxChars || doc.numPages > pages };
  } finally {
    await task.destroy();
  }
}

export async function extractText(filePath: string, extension: string, o: ExtractOptions): Promise<ExtractionResult> {
  switch (extension.toLowerCase()) {
    case '.txt':
    case '.md':
      return extractPlainText(filePath, o);
    case '.pdf':
      return extractPdfText(filePath, o);
    default:
      throw new AppError('UNSUPPORTED_FILE_TYPE', `Text extraction is not supported for ${extension || 'this file type'}. The name and metadata will be used instead.`);
  }
}
