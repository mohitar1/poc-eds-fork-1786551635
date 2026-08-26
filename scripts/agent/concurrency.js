/**
 * Bounded-concurrency map preserving input order. Shared by the converged and classic
 * enrichment controllers (kept in its own module to avoid an import cycle between them).
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: size }, async () => {
    for (;;) {
      const cur = idx;
      idx += 1;
      if (cur >= items.length) return;
      results[cur] = await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return results;
}
