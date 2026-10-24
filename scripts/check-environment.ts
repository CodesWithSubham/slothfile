/* Prints versions and whether the optional Ollama integration is reachable. Run: pnpm check:env */
const major = Number(process.versions.node.split('.')[0]);
console.log(`Node ${process.versions.node} ${major >= 22 ? 'OK' : '(need >= 22.12)'}`);
try {
  const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
  const body = (await res.json()) as { models?: { name: string }[] };
  console.log(`Ollama reachable. Models: ${body.models?.map((m) => m.name).join(', ') || '(none installed)'}`);
} catch {
  console.log('Ollama not reachable (optional). SlothFile works without it.');
}
export {};
