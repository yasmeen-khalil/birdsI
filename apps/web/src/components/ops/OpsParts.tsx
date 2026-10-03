import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Alert, AlertLevel, StageState, VendorCategory, Watch } from "@birdsi/shared";
import { Arc } from "../Arc";
import { CopyButton } from "../CopyButton";
import { LocalTime } from "../LocalTime";
import { icon14 } from "../icon";

/** Display pieces for the operations layer: the pipeline, alerts and money. Server-safe. */

export const FRESHNESS_LABEL: Record<StageState["freshness"], string> = { fresh: "Up to date", stale: "Out of date", never: "Not run yet", running: "Running" };

export const CATEGORY_LABEL: Record<VendorCategory, string> = {
  hosting: "Hosting",
  database: "Database",
  auth: "Sign-in",
  payments: "Payments",
  email: "Email",
  ai: "AI",
  search: "Search",
  analytics: "Analytics",
  storage: "Storage",
  messaging: "Messaging",
  monitoring: "Monitoring",
  maps: "Maps",
  media: "Media",
  other: "Other",
};

export function usd(n: number): string {
  return n >= 100 || Number.isInteger(n) ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

/** Freshness drawn as line, like confidence: filled is fresh, a ring is stale, dashed is never run. */
export function FreshnessGlyph({ freshness, size = 12 }: { freshness: StageState["freshness"]; size?: number }) {
  if (freshness === "running") return <Arc size={size + 2} />;
  return (
    <svg viewBox="0 0 12 12" style={{ width: size, height: size, flex: "none" }} aria-hidden="true" focusable="false">
      {freshness === "fresh" && <circle className="g-proven" cx="6" cy="6" r="5" />}
      {freshness === "stale" && <circle className="g-doc" cx="6" cy="6" r="4.75" />}
      {freshness === "never" && <circle className="g-judg" cx="6" cy="6" r="4.75" />}
    </svg>
  );
}

/** The four stages in order, each with its freshness, last run and what it does. */
export function PipelineStrip({ stages }: { stages: StageState[] }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="pipeline-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="pipeline-title" className="t-label c2">
          Pipeline
        </h2>
        <p className="t-small c3">Stages run in this order. A full scan runs all four; refreshing a later stage first refreshes anything stale before it.</p>
      </div>
      <ol className="pipe m-0 grid list-none grid-cols-1 p-0 min-[901px]:grid-cols-4">
        {stages.map((s, i) => {
          const running = s.freshness === "running";
          return (
            <li key={s.id} className={`pipe-stage${running ? " run" : ""}`}>
              <span className="flex items-center gap-2">
                <span className="t-mono-s c3" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="t-body" style={{ fontWeight: 600 }}>
                  {s.label}
                </span>
              </span>
              <span className="flex items-center gap-2 t-small" style={{ color: running ? "var(--accent)" : s.freshness === "fresh" ? "var(--text)" : "var(--text-2)" }}>
                <FreshnessGlyph freshness={s.freshness} />
                {FRESHNESS_LABEL[s.freshness]}
                {s.lastRunAt && !running && (
                  <span className="c3">
                    {" "}
                    <LocalTime iso={s.lastRunAt} style="relative" />
                  </span>
                )}
              </span>
              <span className="t-small c3">{s.detail}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const LEVEL_TAG: Record<AlertLevel, { cls: string; text: string }> = {
  critical: { cls: "tag bad", text: "Critical" },
  warning: { cls: "tag warn", text: "Warning" },
  info: { cls: "tag", text: "Note" },
};

const LEVEL_RANK: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };

/** Alerts about vendors: limits close to running out, accounts that could not be read, plans unknown. */
export function AlertList({ alerts, vendorsHref, limit }: { alerts: Alert[]; vendorsHref?: string; limit?: number }) {
  const sorted = [...alerts].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <div className="flex flex-col">
      {shown.map((a, i) => (
        <div key={a.id} className="grid grid-cols-1 gap-x-5 gap-y-2 min-[901px]:grid-cols-[96px_minmax(0,1fr)]" style={{ padding: "16px 0", borderTop: "1px solid var(--line)", ...(i === shown.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}) }}>
          <span>
            <span className={LEVEL_TAG[a.level].cls}>{LEVEL_TAG[a.level].text}</span>
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="t-body" style={{ fontWeight: 600 }}>
              {a.title}
            </span>
            <span className="t-small c2">
              {a.detail}
              {a.runsOutAt && (
                <>
                  {" "}
                  Runs out around <LocalTime iso={a.runsOutAt} style="date" />.
                </>
              )}
            </span>
            {a.suggestedCommand && (
              <span className="code mt-1.5 flex items-center justify-between gap-3" style={{ padding: "6px 6px 6px 14px" }}>
                <code className="t-mono-s min-w-0 overflow-x-auto whitespace-pre" style={{ color: "var(--text)" }}>
                  {a.suggestedCommand}
                </code>
                <CopyButton text={a.suggestedCommand} />
              </span>
            )}
          </span>
        </div>
      ))}
      {vendorsHref && (
        <Link className="t-small c2 inline-flex items-center gap-1.5 self-start" href={vendorsHref} style={{ marginTop: 12, minHeight: 32 }}>
          {limit && sorted.length > limit ? `See all ${sorted.length} alerts on the vendors page` : "See the vendors"}
          <ArrowRight {...icon14} />
        </Link>
      )}
    </div>
  );
}

/**
 * Conditions worth tracking, not alerts: something that might happen (a free
 * plan that pauses when idle, a trial that ends). Quiet on purpose, no warning colour.
 */
export function WatchList({ watches, showVendor = true, compact = false }: { watches: Watch[]; showVendor?: boolean; compact?: boolean }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {watches.map((w, i) => (
        <li key={w.id} className="flex flex-col gap-1" style={{ padding: compact ? "10px 0" : "14px 0", borderTop: "1px solid var(--line)", ...(i === watches.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}) }}>
          <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <span className={compact ? "t-small" : "t-body"} style={{ fontWeight: 600 }}>
              {showVendor && w.vendorName ? `${w.vendorName}: ` : ""}
              {w.title}
            </span>
            {w.dueAt && (
              <span className="t-small c2">
                <LocalTime iso={w.dueAt} style="date" />
              </span>
            )}
          </span>
          <span className="t-small c2">{w.detail}</span>
          {w.needs && <span className="t-small c3">To know for sure: {w.needs}</span>}
        </li>
      ))}
    </ul>
  );
}
