import { z } from "zod";

/**
 * What no API reports, entered by the owner: a subscription paid elsewhere,
 * a yearly fee, a credit that runs out, a note. Kept apart from everything
 * read, counted in the money section as entered by hand.
 */

export const EntryKind = z.enum(["subscription", "fee", "credit", "note"]);
export type EntryKind = z.infer<typeof EntryKind>;

export const EntryPeriod = z.enum(["month", "year", "once"]);
export type EntryPeriod = z.infer<typeof EntryPeriod>;

export const ENTRY_KIND_LABEL: Record<EntryKind, string> = { subscription: "Subscription", fee: "Fee", credit: "Credit", note: "Note" };
export const ENTRY_PERIOD_LABEL: Record<EntryPeriod, string> = { month: "a month", year: "a year", once: "once" };

export const AppEntry = z.object({
  id: z.string(),
  appId: z.string(),
  vendor: z.string().nullable(),
  kind: EntryKind,
  label: z.string(),
  amountUsd: z.number().nullable(),
  period: EntryPeriod.nullable(),
  /** The next renewal or end, as a date. It joins the alerts like a date to watch. */
  renewsOn: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type AppEntry = z.infer<typeof AppEntry>;

export const AddEntryRequest = z.object({
  kind: EntryKind,
  label: z.string().trim().min(2).max(120),
  amountUsd: z.number().min(0).max(1_000_000).nullable().default(null),
  period: EntryPeriod.nullable().default(null),
  renewsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date as YYYY-MM-DD.").nullable().default(null),
  vendor: z.string().trim().max(40).nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
});
export type AddEntryRequest = z.infer<typeof AddEntryRequest>;

export const EntriesResponse = z.object({ entries: z.array(AppEntry), reason: z.string().nullable() });
export type EntriesResponse = z.infer<typeof EntriesResponse>;

/** What a recurring entry costs a month: a yearly amount spread over twelve months. Null for a credit, a note or a one-time amount. */
export function entryMonthlyUsd(entry: Pick<AppEntry, "kind" | "amountUsd" | "period">): number | null {
  if (entry.kind !== "subscription" && entry.kind !== "fee") return null;
  if (entry.amountUsd === null || entry.period === null || entry.period === "once") return null;
  return entry.period === "month" ? entry.amountUsd : Math.round((entry.amountUsd / 12) * 100) / 100;
}

/** An entry's amount in words: "$99 a year", "$300 once", or nothing. */
export function entryAmountWords(entry: Pick<AppEntry, "amountUsd" | "period">): string | null {
  if (entry.amountUsd === null) return null;
  const amount = `$${entry.amountUsd.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(entry.amountUsd) ? 0 : 2, maximumFractionDigits: 2 })}`;
  return entry.period ? `${amount} ${ENTRY_PERIOD_LABEL[entry.period]}` : amount;
}
