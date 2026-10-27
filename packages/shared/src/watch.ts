import { z } from "zod";

/** One check of one pricing page the checked limits list rests on: which quoted sentences are gone, and what the page appears to say now. */
export const LimitsDrift = z.object({
  vendor: z.string(),
  url: z.string(),
  checkedAt: z.string(),
  quotesTotal: z.number().int(),
  missing: z.array(z.object({ label: z.string(), quote: z.string() })),
  /** What the page states now, as the model read it. Judgment, for a person to confirm. */
  proposal: z.string().nullable(),
  /** Why the page could not be checked, or null. */
  error: z.string().nullable(),
});
export type LimitsDrift = z.infer<typeof LimitsDrift>;
