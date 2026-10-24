import { describe, expect, it } from 'vitest';
import { extractText } from '../../src/main/documents/extractors';
import { makeTempDir, writeFixture } from '../helpers/tmp';
import { tinyPdf } from '../helpers/pdf';

const opts = { maxFileBytes: 1024 * 1024, maxChars: 200 };

describe('extractors', () => {
  it('extracts bounded text from txt and md', async () => {
    const root = await makeTempDir();
    const t = await writeFixture(root, 'a.txt', 'Hello   world\n'.repeat(100));
    const r = await extractText(t, '.txt', opts);
    expect(r.text.length).toBeLessThanOrEqual(200);
    expect(r.truncated).toBe(true);
    expect((await extractText(await writeFixture(root, 'n.md', '# Title\nbody'), '.md', opts)).text).toBe('# Title body');
  });
  it('rejects binary content disguised as text', async () => {
    const root = await makeTempDir();
    const f = await writeFixture(root, 'fake.txt', Buffer.from([0x50, 0x4b, 0, 0, 1, 2]));
    await expect(extractText(f, '.txt', opts)).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
  });
  it('extracts text from a real PDF', async () => {
    const root = await makeTempDir();
    const f = await writeFixture(root, 'sample-report.pdf', tinyPdf('Quarterly Sales Report'));
    const r = await extractText(f, '.pdf', opts);
    expect(r.text).toContain('Quarterly Sales Report');
  });
  it('reports a malformed PDF and a PDF with no text layer without crashing', async () => {
    const root = await makeTempDir();
    await expect(extractText(await writeFixture(root, 'bad.pdf', 'not a pdf'), '.pdf', opts)).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    const blank = await writeFixture(root, 'blank.pdf', tinyPdf(''));
    await expect(extractText(blank, '.pdf', opts)).rejects.toThrow(/No extractable text|OCR/);
  });
  it('refuses oversized PDFs and unsupported types', async () => {
    const root = await makeTempDir();
    const f = await writeFixture(root, 'big.pdf', tinyPdf('x'));
    await expect(extractText(f, '.pdf', { ...opts, maxFileBytes: 10 })).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    await expect(extractText(f, '.docx', opts)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });
});
