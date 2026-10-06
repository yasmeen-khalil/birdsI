import type { Confidence, Finding, Location, ScanKind, Severity } from "@birdsi/shared";

/** Plain-language labels and formatting shared by server and client components. */

export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
export const SEVERITY_CLASS: Record<Severity, string> = { critical: "crit", high: "high", medium: "med", low: "low" };
export const CONFIDENCE_LABEL: Record<Confidence, string> = { proven: "Proven", doc_verified: "Doc-verified", judgment: "Judgment" };
export const CONFIDENCE_MEANING: Record<Confidence, string> = {
  proven: "A fixed rule or tool found this, not a model. Run the scan again and you get the same answer.",
  doc_verified: "Checked against the vendor's current official docs for the version you use. The next full scan checks again.",
  judgment: "birdsI’s reading of your code. Usually right, but read the evidence before you act on it.",
};
export const KIND_LABEL: Record<ScanKind, string> = { light: "Quick check", deep: "Full scan", audit: "Pre-launch audit" };
export const KIND_LOWER: Record<ScanKind, string> = { light: "quick check", deep: "full scan", audit: "pre-launch audit" };
/** Expected run time in seconds, used for "of about" lines. */
export const KIND_SECONDS: Record<ScanKind, number> = { light: 120, deep: 900, audit: 1800 };
export const KIND_DURATION: Record<ScanKind, string> = { light: "About 2 min", deep: "10 to 20 min", audit: "20 to 40 min" };

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;
}

export function locationText(location: Location | null | undefined): string {
  if (!location) return "";
  if (location.lineStart && location.lineEnd && location.lineEnd !== location.lineStart) return `${location.path}, lines ${location.lineStart} to ${location.lineEnd}`;
  if (location.lineStart) return `${location.path}, line ${location.lineStart}`;
  return location.path;
}

export function repoName(fullName: string): string {
  const slash = fullName.indexOf("/");
  return slash === -1 ? fullName : fullName.slice(slash + 1);
}

export function repoOwner(fullName: string): string {
  const slash = fullName.indexOf("/");
  return slash === -1 ? "" : fullName.slice(0, slash);
}

export function initials(login: string | null | undefined): string {
  if (!login) return "?";
  const parts = login.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return login.slice(0, 2).toUpperCase();
}

/** "4 min 12 s", "52 s". */
export function shortDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} s`;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

/** "1 minute 54 seconds". */
export function longDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return plural(s, "second");
  return s === 0 ? plural(m, "minute") : `${plural(m, "minute")} ${plural(s, "second")}`;
}

/** "1:12". */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "about 2:00" or "about 6 min". */
export function aboutTime(seconds: number): string {
  return seconds < 180 ? clock(seconds) : `${Math.round(seconds / 60)} min`;
}

export function shortSha(sha: string | null | undefined): string | null {
  return sha ? sha.slice(0, 7) : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Human time relative to now, in the viewer's time zone when run in the browser.
 * sentence: "today at 09:42"; list: "Today, 09:42"; date: "22 Sep 2026".
 */
export function formatWhen(iso: string | null | undefined, style: "sentence" | "list" | "date" | "relative" = "sentence", now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (style === "date") return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (style === "relative") {
    const mins = Math.round((now.getTime() - d.getTime()) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${plural(mins, "minute")} ago`;
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 14) return "last week";
    if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 62) return "last month";
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? "" : ` ${d.getFullYear()}`}`;
  if (style === "list") {
    if (days === 0) return `Today, ${time}`;
    if (days === 1) return `Yesterday, ${time}`;
    return `${date}, ${time}`;
  }
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return `${date} at ${time}`;
}

/** Only http and https links are rendered; anything else from a model or a web search is dropped. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const CONF_RANK: Record<Confidence, number> = { proven: 0, doc_verified: 1, judgment: 2 };

export function compareFindings(a: Finding, b: Finding): number {
  return SEV_RANK[a.severity] - SEV_RANK[b.severity] || CONF_RANK[a.confidence] - CONF_RANK[b.confidence] || a.title.localeCompare(b.title);
}

export function worseSeverity(a: Severity | undefined, b: Severity): Severity {
  if (!a) return b;
  return SEV_RANK[a] <= SEV_RANK[b] ? a : b;
}

/** Top folder display name used by the bird's-eye map. */
export function folderLabel(name: string): string {
  return name === "." ? "root" : `${name}/`;
}

/** A link to a file on GitHub, for citations and evidence. */
export function githubFileUrl(fullName: string, branch: string | null | undefined, path: string, line?: number): string {
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${fullName}/blob/${encodeURIComponent(branch ?? "HEAD")}/${safePath}${line ? `#L${line}` : ""}`;
}

/** "12 findings. birdsI can fix 7 of them. 5 need you." */
export function findingsHeadline(n: number, fixable: number): string {
  const needs = n - fixable;
  if (n === 0) return "Nothing needs you right now.";
  if (fixable === n) return `${plural(n, "finding")}. birdsI can fix ${n === 1 ? "it" : "all of them"}.`;
  if (needs === n) return `${plural(n, "finding")}. ${n === 1 ? "It needs" : "All of them need"} you.`;
  return `${plural(n, "finding")}. birdsI can fix ${fixable} of them. ${needs} ${needs === 1 ? "needs" : "need"} you.`;
}
