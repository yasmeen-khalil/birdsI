import { getDb } from "./client";
import { pageAll } from "./paging";

/** Append-only. Rows are priced when written and never changed. */
export async function recordUsage(input: { ownerUserId: string | null; scanId: string | null; fixId: string | null; purpose: string; model: string; inputTokens: number; outputTokens: number; costMicrodollars: number }): Promise<void> {
  const db = getDb();
  const { error } = await db.from("usage_ledger").insert({
    owner_user_id: input.ownerUserId,
    scan_id: input.scanId,
    fix_id: input.fixId,
    purpose: input.purpose,
    model: input.model,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    cost_microdollars: input.costMicrodollars,
  });
  if (error) throw new Error(`recordUsage: ${error.message}`);
}

export async function usageForUser(userId: string, since: Date): Promise<{ inputTokens: number; outputTokens: number; costMicrodollars: number; calls: number }> {
  const db = getDb();
  const rows = await pageAll<{ input_tokens: number; output_tokens: number; cost_microdollars: number }>(
    (from, to) => db.from("usage_ledger").select("input_tokens, output_tokens, cost_microdollars").eq("owner_user_id", userId).gte("at", since.toISOString()).order("id", { ascending: true }).range(from, to),
    "usageForUser",
  );
  return rows.reduce(
    (acc, r) => ({ inputTokens: acc.inputTokens + r.input_tokens, outputTokens: acc.outputTokens + r.output_tokens, costMicrodollars: acc.costMicrodollars + r.cost_microdollars, calls: acc.calls + 1 }),
    { inputTokens: 0, outputTokens: 0, costMicrodollars: 0, calls: 0 },
  );
}

/** Total spend across all users since a date, for the global demo and credit caps. */
export async function totalSpend(since: Date): Promise<number> {
  const db = getDb();
  const rows = await pageAll<{ cost_microdollars: number }>(
    (from, to) => db.from("usage_ledger").select("cost_microdollars").gte("at", since.toISOString()).order("id", { ascending: true }).range(from, to),
    "totalSpend",
  );
  return rows.reduce((n, r) => n + r.cost_microdollars, 0);
}
