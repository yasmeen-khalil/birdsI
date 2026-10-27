import { totalSpend, usageForUser } from "@birdsi/db";
import { BudgetExceededError, type BeforeCall } from "@birdsi/engine";

/**
 * The daily spending limits on model calls. Since v3 only the official-docs
 * check calls a model, so a limit never stops a map: it stops the docs check,
 * and the map says so. Checked before every model call; the ledger totals are
 * cached for half a minute, so the overshoot is at most the calls made inside
 * that window.
 */
const CACHE_MS = 30_000;
const DAY_MS = 86_400_000;

/**
 * Named like the per-scan budget error, so the checks stop reading files
 * quietly instead of reporting the refusal once per file.
 */
export class SpendCapError extends BudgetExceededError {}

function capUsd(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const cache = new Map<string, { at: number; spent: Promise<number> }>();

function spentFor(key: string, load: () => Promise<number>, fresh: boolean): Promise<number> {
  const cached = cache.get(key);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.spent;
  const spent = load();
  cache.set(key, { at: Date.now(), spent });
  // A failed read is not cached, so the next call asks again.
  spent.catch(() => cache.delete(key));
  return spent;
}

/** Throws SpendCapError when the global or this user's daily spend has reached its cap. */
export async function assertWithinSpendCaps(ownerUserId: string | null, options: { fresh?: boolean } = {}): Promise<void> {
  const fresh = options.fresh ?? false;
  const since = () => new Date(Date.now() - DAY_MS);
  const globalCap = capUsd("BIRDSI_DAILY_SPEND_CAP_USD", 50);
  const globalSpent = await spentFor("global", () => totalSpend(since()), fresh);
  if (globalSpent >= globalCap * 1_000_000) {
    throw new SpendCapError("birdsI has reached its daily budget for model calls. Maps still run by rules, without the model's reading and the docs check, and the budget opens again within 24 hours.");
  }
  if (!ownerUserId) return;
  const userCap = capUsd("BIRDSI_USER_DAILY_SPEND_CAP_USD", 5);
  const userSpent = await spentFor(`user:${ownerUserId}`, async () => (await usageForUser(ownerUserId, since())).costMicrodollars, fresh);
  if (userSpent >= userCap * 1_000_000) {
    throw new SpendCapError(`You have used today's model budget ($${userCap}). Maps still run by rules, without the model's reading and the docs check, and the budget opens again within 24 hours.`);
  }
}

/** The model client hook for one job; remembers the refusal so the job can say why it stopped early. */
export function spendHook(ownerUserId: string | null): { beforeCall: BeforeCall; refusal: () => string | null } {
  let refusal: string | null = null;
  return {
    beforeCall: async () => {
      try {
        await assertWithinSpendCaps(ownerUserId);
      } catch (error) {
        if (error instanceof SpendCapError) refusal = error.message;
        throw error;
      }
    },
    refusal: () => refusal,
  };
}
