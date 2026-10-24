import http from 'node:http';
import type { AddressInfo } from 'node:net';

const BY_NAME: Record<string, { category: string; suggestedName: string; confidence: number; reason: string }> = {
  'random-name-01.txt': { category: 'education', suggestedName: 'semester-5-notes', confidence: 0.94, reason: 'Looks like university study notes.' },
  'lecture-notes.md': { category: 'education', suggestedName: 'lecture-notes', confidence: 0.9, reason: 'Lecture notes.' },
  'sample-report.pdf': { category: 'finance', suggestedName: 'quarterly-sales-report', confidence: 0.55, reason: 'A sales report.' },
  'image-copy-a.png': { category: 'images', suggestedName: 'holiday-photo', confidence: 0.8, reason: 'An image.' },
  'image-copy-b.png': { category: 'images', suggestedName: 'holiday-photo', confidence: 0.8, reason: 'An image.' }
};

/** Deterministic stand-in for Ollama's HTTP API, so e2e never needs a live model. */
export async function startFakeOllama(): Promise<{ url: string; close: () => Promise<void>; requests: number }> {
  const state = { requests: 0 };
  const server = http.createServer((req, res) => {
    const send = (body: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/api/tags') return send({ models: [{ name: 'fake-gemma:1b', size: 1 }] });
    if (req.url === '/api/chat') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        state.requests++;
        const user = (JSON.parse(raw) as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === 'user')?.content ?? '';
        const name = /File name: (.+)/.exec(user)?.[1]?.trim() ?? '';
        send({ message: { content: JSON.stringify(BY_NAME[name] ?? { category: 'other', suggestedName: 'unknown', confidence: 0.2, reason: 'Unknown.' }) } });
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, get requests() { return state.requests; }, close: () => new Promise((r) => server.close(() => r())) };
}
