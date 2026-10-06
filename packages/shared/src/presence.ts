/** How long since any worker reported in before a page or the terminal says so, in minutes. */
const STALE_MINUTES = 2;

/**
 * The honest line for a queued scan: nothing while a scanner reported in
 * recently (or presence is unknown), a plain statement once none has.
 */
export function scannerNote(workerSeenAt: string | null | undefined, now = Date.now()): string | null {
  if (!workerSeenAt) return null;
  const minutes = Math.floor((now - new Date(workerSeenAt).getTime()) / 60_000);
  if (minutes < STALE_MINUTES) return null;
  const ago = minutes < 60 ? `${minutes} minutes` : minutes < 1440 ? `${Math.floor(minutes / 60)} hours` : `${Math.floor(minutes / 1440)} days`;
  return `No scanner has reported in for ${ago}. The scan starts when one is back.`;
}
