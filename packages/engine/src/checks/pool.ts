/**
 * Runs fn over items with at most `concurrency` in flight. Items start in
 * order; completion order is not preserved. A throwing fn rejects the whole
 * pool, so callers that want to continue catch inside fn.
 */
export async function runPool<T>(items: readonly T[], concurrency: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  const width = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: width }, lane));
}
