import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { FACT_SOURCE_LABEL, type FactKind, type Runway, type Vendor, type VendorFact, type Watch } from "@birdsi/shared";
import { LocalTime } from "../LocalTime";
import { hostOf, safeUrl } from "../format";
import { icon14 } from "../icon";
import { CATEGORY_LABEL, WatchList } from "./OpsParts";

const FACT_ORDER: FactKind[] = ["plan", "cost", "usage", "limit", "billing", "status"];
const FACT_HEADING: Record<FactKind, string> = { plan: "Plan", cost: "Cost", usage: "Usage", limit: "Limits", billing: "Billing", status: "Status", purpose: "Purpose" };
const DETECTED_LABEL: Record<Vendor["detectedBy"][number], string> = { package: "package", env: "env", url: "url", config: "config", projects: "Stripe Projects" };
const CALL_SITES_SHOWN = 6;

function UsageBar({ fact }: { fact: VendorFact }) {
  if (fact.numeric == null || fact.limitNumeric == null || fact.limitNumeric <= 0) return null;
  const ratio = fact.numeric / fact.limitNumeric;
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const tone = ratio >= 0.95 ? "var(--critical)" : ratio >= 0.8 ? "var(--high)" : "var(--text-2)";
  return (
    <span className="flex items-center gap-2.5">
      <span className="bar" style={{ flex: 1, height: 3 }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${fact.label}: ${pct}% of the limit`}>
        <i style={{ width: `${pct}%`, background: tone }} />
      </span>
      <span className="t-mono-s" style={{ color: ratio >= 0.8 ? tone : "var(--text-3)", minWidth: 36, textAlign: "right" }}>
        {pct}%
      </span>
    </span>
  );
}

function FactLine({ fact, runway }: { fact: VendorFact; runway?: Runway }) {
  const url = safeUrl(fact.evidence?.url);
  return (
    <div className="flex flex-col gap-1" style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
      <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4">
        <span className="t-small c2">{fact.label}</span>
        <span className="t-body text-right" style={{ fontWeight: 600 }}>
          {fact.value}
          {fact.unit && !fact.value.includes(fact.unit) ? <span className="c2" style={{ fontWeight: 400 }}>{` ${fact.unit}`}</span> : null}
        </span>
      </span>
      {fact.kind === "usage" && <UsageBar fact={fact} />}
      {runway?.runsOutAt && (
        <span className="t-small c3">
          At the current rate, runs out around <LocalTime iso={runway.runsOutAt} style="date" />
        </span>
      )}
      <span className="t-small c3 flex flex-wrap items-center gap-x-2">
        <span>{FACT_SOURCE_LABEL[fact.source]}</span>
        <span aria-hidden="true">/</span>
        <LocalTime iso={fact.observedAt} style="relative" />
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 c3">
            {hostOf(url)}
            <ExternalLink {...icon14} />
          </a>
        )}
      </span>
    </div>
  );
}

/** One vendor: what it is, what this app uses it for, how birdsI knows, and every fact with its source. */
export function VendorCard({ vendor, watches = [], runways = [] }: { vendor: Vendor; watches?: Watch[]; runways?: Runway[] }) {
  const runwayFor = new Map(runways.map((r) => [r.metric, r]));
  const groups = FACT_ORDER.map((kind) => ({ kind, facts: vendor.facts.filter((f) => f.kind === kind) })).filter((g) => g.facts.length > 0);
  const docs = safeUrl(vendor.docsUrl);
  const pricing = safeUrl(vendor.pricingUrl);
  const sites = vendor.callSites.slice(0, CALL_SITES_SHOWN);
  const more = vendor.callSites.length - sites.length;

  return (
    <article className="panel grid grid-cols-1 gap-x-8 gap-y-5 min-[901px]:grid-cols-12" style={{ padding: "24px 26px" }} aria-labelledby={`v-${vendor.id}`}>
      <div className="flex min-w-0 flex-col gap-3 min-[901px]:col-span-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 id={`v-${vendor.id}`} className="t-h2" style={{ fontSize: 24 }}>
            {vendor.name}
          </h3>
          <span className="tag">{CATEGORY_LABEL[vendor.category]}</span>
          {vendor.connected && <span className="tag ok">Connected</span>}
        </div>
        {vendor.what && <p className="t-body c2">{vendor.what}</p>}
        {vendor.purpose && (
          <div className="flex flex-col gap-1">
            <span className="t-label c3">In this app, as birdsI reads it</span>
            <p className="t-body">{vendor.purpose}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="t-small c3" style={{ marginRight: 4 }}>
            Found in code:
          </span>
          {vendor.detectedBy.map((d) => (
            <span key={d} className="tag" style={{ height: 20, fontSize: 11.5 }}>
              {DETECTED_LABEL[d]}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {vendor.connectable && !vendor.connected && (
            <Link href="/settings#connected-accounts" className="t-small c2">
              Connect in Settings
            </Link>
          )}
          {pricing && (
            <a href={pricing} target="_blank" rel="noreferrer" className="t-small c2 inline-flex items-center gap-1">
              Pricing
              <ExternalLink {...icon14} />
            </a>
          )}
          {docs && (
            <a href={docs} target="_blank" rel="noreferrer" className="t-small c2 inline-flex items-center gap-1">
              Docs
              <ExternalLink {...icon14} />
            </a>
          )}
        </div>
        {vendor.callSites.length > 0 && (
          <details className="disclose">
            <summary className="t-small c2">Where it is used ({vendor.callSites.length})</summary>
            <ul className="m-0 flex list-none flex-col gap-2 p-0" style={{ marginTop: 10 }}>
              {sites.map((c) => (
                <li key={`${c.path}:${c.line}`} className="flex min-w-0 flex-col gap-0.5">
                  <span className="path">
                    {c.path}:{c.line}
                  </span>
                  <code className="t-mono-s c3 truncate">{c.excerpt}</code>
                </li>
              ))}
              {more > 0 && <li className="t-small c3">and {more} more</li>}
            </ul>
          </details>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4 min-[901px]:col-span-7">
        {groups.length === 0 ? (
          <p className="t-small c3" style={{ padding: "12px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
            {vendor.connectable && !vendor.connected ? "Nothing known about the plan or usage yet. Connect the account, or answer the questions on the Agent page." : "Nothing known about the plan or usage yet. Answer the questions on the Agent page so birdsI can watch its limits."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.kind} className="flex flex-col">
              <h4 className="t-label c3" style={{ paddingBottom: 4 }}>
                {FACT_HEADING[g.kind]}
              </h4>
              {g.facts.map((f) => (
                <FactLine key={f.id} fact={f} runway={f.kind === "usage" ? runwayFor.get(f.metric) : undefined} />
              ))}
            </div>
          ))
        )}
        {watches.length > 0 && (
          <div className="flex flex-col">
            <h4 className="t-label c3" style={{ paddingBottom: 4 }}>
              Tracking
            </h4>
            <WatchList watches={watches} showVendor={false} compact />
          </div>
        )}
      </div>
    </article>
  );
}
