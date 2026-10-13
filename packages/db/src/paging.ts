/** Supabase returns at most this many rows per request unless told otherwise. */
export const PAGE_SIZE = 1000;

/**
 * Reads every row of a query by asking for consecutive ranges of PAGE_SIZE
 * until a short page comes back. The query must have a stable order (by a
 * unique column) so rows are neither skipped nor read twice.
 */
export async function pageAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  context: string,
  maxRows = 1_000_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${context}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}
