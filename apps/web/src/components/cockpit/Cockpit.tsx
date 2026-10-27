import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import type { CockpitView, CronRow, OneSignalCard, SupabaseCard, VercelCard } from "@birdsi/shared";
import { AlertItem } from "../alerts/AlertStream";
import { LocalTime } from "../LocalTime";
import { plural, safeUrl, shortSha } from "../format";
import { icon14 } from "../icon";

/**
 * The cockpit of one app, rendered from the view every surface shares: the
 * alerts, then each Vercel project, Supabase project and OneSignal app with
 * what its read says, then what the map read from the code. Nothing here is
 * written per app: an app with only a map renders from the map.
 */

type Part<T> = { ok: true; value: T } | { ok: false; reason: string };

function NotRead({ reason }: { reason: string }) {
  return <p className="t-small c3">Not read: {reason.replace(/^Not read(:|,)?\s*/i, "")}</p>;
}

function PartView<T>({ part, children }: { part: Part<T>; children: (value: T) => ReactNode }) {
  return part.ok ? <>{children(part.value)}</> : <NotRead reason={part.reason} />;
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <div className="flex flex-col gap-1.5">
        <h2 id={id} className="t-h2 max-[900px]:text-[24px]!">
          {title}
        </h2>
        {intro && <p className="t-body c2" style={{ maxWidth: 760 }}>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function Out({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  const link = safeUrl(href);
  if (!link) return <>{children}</>;
  return (
    <a className="c2 inline-flex items-center gap-1" href={link} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink {...icon14} />
    </a>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
      <span className="t-label c3">{label}</span>
      <div className="t-small">{children}</div>
    </div>
  );
}

function CardHead({ card, vendor, extra }: { card: { title: string; dashboardUrl: string | null; readAt: string | null; state: string; reason: string | null }; vendor: string; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <span className="flex min-w-0 flex-col gap-1">
        <span className="t-body inline-flex flex-wrap items-center gap-2" style={{ fontWeight: 600 }}>
          {card.title}
          {extra}
        </span>
        <span className="t-small c3">
          {vendor}
          {card.readAt ? (
            <>
              , read <LocalTime iso={card.readAt} style="relative" />
            </>
          ) : null}
        </span>
      </span>
      {card.dashboardUrl && (
        <a className="btn btn-quiet btn-sm" href={safeUrl(card.dashboardUrl) ?? undefined} target="_blank" rel="noreferrer" style={{ minHeight: 32, fontSize: 13 }}>
          Open
          <ExternalLink {...icon14} />
        </a>
      )}
    </div>
  );
}

const STATE_TAG: Record<string, { label: string; className: string }> = {
  READY: { label: "Ready", className: "tag ok" },
  ERROR: { label: "Failed", className: "tag bad" },
  BUILDING: { label: "Building", className: "tag run" },
  QUEUED: { label: "Queued", className: "tag run" },
  INITIALIZING: { label: "Starting", className: "tag run" },
  CANCELED: { label: "Canceled", className: "tag" },
  BLOCKED: { label: "Blocked", className: "tag warn" },
  DELETED: { label: "Deleted", className: "tag" },
  UNKNOWN: { label: "Unknown", className: "tag" },
};

function VercelProject({ card }: { card: VercelCard }) {
  const prod = card.production;
  const tag = prod ? (STATE_TAG[prod.state] ?? STATE_TAG["UNKNOWN"]!) : null;
  return (
    <article className="panel flex flex-col gap-4" style={{ padding: "18px 20px" }}>
      <CardHead card={card} vendor="Vercel project" extra={card.role ? <span className="tag">{card.role} deployment</span> : null} />
      {card.state !== "read" ? (
        <p className="t-small c2">{card.reason}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[901px]:grid-cols-2">
          <Fact label="Production">
            <PartView part={card.deploymentsPart}>
              {() =>
                prod ? (
                  <span className="flex flex-col gap-1">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {tag && <span className={tag.className}>{tag.label}</span>}
                      <span className="c2">
                        <LocalTime iso={prod.createdAt} style="relative" />
                        {prod.commitSha ? `, ${shortSha(prod.commitSha)}` : ""}
                        {prod.commitMessage ? `, ${prod.commitMessage}` : ""}
                      </span>
                    </span>
                    {prod.state === "ERROR" && prod.errorMessage && <span style={{ color: "var(--critical)" }}>{prod.errorMessage}</span>}
                    {prod.state === "ERROR" && card.live && (
                      <span className="c3">
                        Live: the deployment from <LocalTime iso={card.live.createdAt} style="date" />.
                      </span>
                    )}
                    {card.productionUrl && <Out href={card.productionUrl}>{card.productionUrl.replace(/^https:\/\//, "")}</Out>}
                  </span>
                ) : (
                  <span className="c2">No production deployment in the last {plural(card.recent.length, "deployment")}.</span>
                )
              }
            </PartView>
          </Fact>
          <Fact label="Env names the code needs">
            <PartView part={card.env}>
              {(checks) => (
                <span className="flex flex-col gap-1">
                  {checks.map((c) => (
                    <span key={c.environment}>
                      <span className={c.missing.length > 0 ? "" : "c2"}>
                        {c.environment}: {c.set} of {c.needed} set
                      </span>
                      {c.missing.length > 0 && (
                        <span style={{ color: "var(--critical)" }}>
                          , missing <span className="t-mono-s">{c.missing.join(", ")}</span>
                        </span>
                      )}
                      {c.optionalMissing.length > 0 && <span className="c3">. Optional and unset: {c.optionalMissing.length}</span>}
                    </span>
                  ))}
                </span>
              )}
            </PartView>
          </Fact>
          <Fact label="Crons">
            <PartView part={card.crons}>
              {(crons) =>
                crons.expected.length === 0 && crons.other.length === 0 ? (
                  <span className="c2">None in this project&apos;s vercel.json.</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    {!crons.enabled && <span style={{ color: "var(--critical)" }}>Switched off on Vercel.</span>}
                    {crons.expected.map((c) => (
                      <span key={c.path}>
                        <span className="t-mono-s">{c.path}</span> <span className="c3">{c.every}</span>{" "}
                        {c.registered ? <span className="tag ok">Registered</span> : <span className="tag bad">Not registered</span>}
                      </span>
                    ))}
                    {crons.other.length > 0 && <span className="c3">Also on Vercel, not in the code: {crons.other.join(", ")}</span>}
                  </span>
                )
              }
            </PartView>
          </Fact>
          <Fact label="Domains">
            <PartView part={card.domains}>
              {(domains) =>
                domains.length === 0 ? (
                  <span className="c2">None but the vercel.app address.</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    {domains.slice(0, 6).map((d) => (
                      <span key={d.name}>
                        {d.name}
                        {d.redirect ? <span className="c3"> redirects to {d.redirect}</span> : null}
                        {d.verified === false ? <span className="tag bad" style={{ marginLeft: 6 }}>Not verified</span> : null}
                      </span>
                    ))}
                  </span>
                )
              }
            </PartView>
          </Fact>
          <Fact label="Errors in the logs">
            <PartView part={card.errors}>
              {(lines) =>
                lines.length === 0 ? (
                  <span className="c2">None read: no failed build in the last deployments, and no function error in the minutes read.</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    {lines.slice(0, 4).map((l, i) => (
                      <span key={i} className="t-mono-s break-all">
                        {l.from === "build" ? "Build" : "Function"}: {l.text}
                      </span>
                    ))}
                  </span>
                )
              }
            </PartView>
          </Fact>
          <Fact label="The key">
            <PartView part={card.keyExpiry}>
              {(expires) => (expires ? <span>Expires <LocalTime iso={expires} style="date" />.</span> : <span className="c2">No expiry set on Vercel.</span>)}
            </PartView>
          </Fact>
        </div>
      )}
    </article>
  );
}

function SupabaseProject({ card }: { card: SupabaseCard }) {
  return (
    <article className="panel flex flex-col gap-4" style={{ padding: "18px 20px" }}>
      <CardHead card={card} vendor="Supabase project" extra={card.paused ? <span className="tag bad">Paused</span> : card.status === "ACTIVE_HEALTHY" ? <span className="tag ok">Running</span> : card.status ? <span className="tag warn">{card.status.toLowerCase().replace(/_/g, " ")}</span> : null} />
      {card.state !== "read" ? (
        <p className="t-small c2">{card.reason}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[901px]:grid-cols-2">
          <Fact label="Database size">
            <PartView part={card.size}>
              {(s) => (
                <span>
                  {s.mb.toLocaleString("en-US")} MB
                  {s.limitMb ? <span className="c2"> of {s.limitMb.toLocaleString("en-US")} MB on the {s.plan} plan ({Math.round((s.mb / s.limitMb) * 100)}%)</span> : s.plan ? <span className="c3"> ({s.plan} plan)</span> : null}
                </span>
              )}
            </PartView>
          </Fact>
          <Fact label="Migrations">
            <PartView part={card.migrations}>
              {(m) =>
                m.method === "none" ? (
                  <span className="c2">{m.how}</span>
                ) : m.owed.length === 0 ? (
                  <span className="c2">Nothing owed: all {plural(m.checked, m.method === "markers" ? "marker" : "file")} found.</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    {m.owed.map((o) => (
                      <span key={o.migration}>
                        <span className="tag bad">Owed</span> <span className="t-mono-s">{o.file ?? o.migration}</span> <span className="c3">{o.missing.join(", ")}</span>
                      </span>
                    ))}
                  </span>
                )
              }
            </PartView>
          </Fact>
          {(["security", "performance"] as const).map((kind) => (
            <Fact key={kind} label={kind === "security" ? "Security advisor" : "Performance advisor"}>
              <PartView part={card[kind]}>
                {(lints) => {
                  const errors = lints.filter((l) => l.level === "ERROR").length;
                  const warns = lints.filter((l) => l.level === "WARN").length;
                  if (errors + warns === 0) return <span className="c2">No errors or warnings{lints.length > 0 ? `, ${plural(lints.length, "note")}` : ""}.</span>;
                  return (
                    <span className="flex flex-col gap-1">
                      <span>
                        {errors > 0 && <span style={{ color: "var(--critical)" }}>{plural(errors, "error")}</span>}
                        {errors > 0 && warns > 0 ? ", " : ""}
                        {warns > 0 && <span>{plural(warns, "warning")}</span>}
                      </span>
                      {lints
                        .filter((l) => l.level !== "INFO")
                        .slice(0, 3)
                        .map((l, i) => (
                          <span key={`${l.name}-${i}`} className="c2">
                            {l.title}: {l.detail}
                          </span>
                        ))}
                    </span>
                  );
                }}
              </PartView>
            </Fact>
          ))}
        </div>
      )}
    </article>
  );
}

function OneSignalApp({ card }: { card: OneSignalCard }) {
  return (
    <article className="panel flex flex-col gap-4" style={{ padding: "18px 20px" }}>
      <CardHead card={card} vendor="OneSignal app" extra={card.audience.ok && card.audience.value.mobileSuppressed ? <span className="tag bad">Mobile push dropped</span> : null} />
      {card.state !== "read" ? (
        <p className="t-small c2">{card.reason}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[901px]:grid-cols-2">
          <Fact label="Subscriptions">
            <PartView part={card.app}>
              {(a) => (
                <span>
                  {a.subscribed !== null ? `${a.subscribed.toLocaleString("en-US")} can receive a message` : "Not reported"}
                  {a.subscriptions !== null ? <span className="c2">, of {a.subscriptions.toLocaleString("en-US")}</span> : null}
                  {a.platforms.length > 0 ? <span className="c3">. Set up for {a.platforms.join(", ")}.</span> : null}
                </span>
              )}
            </PartView>
          </Fact>
          <Fact label="A send to everyone">
            <PartView part={card.audience}>
              {(a) => (
                <span>
                  {a.pushRecipients !== null ? `${a.pushRecipients.toLocaleString("en-US")} push recipients, as OneSignal estimates` : "No estimate"}
                  {a.mobileSuppressed ? <span style={{ color: "var(--critical)" }}>. Mobile push is dropped for the plan.</span> : "."}
                </span>
              )}
            </PartView>
          </Fact>
          <Fact label="Recent messages">
            <PartView part={card.notifications}>
              {(n) =>
                n.recent.length === 0 ? (
                  <span className="c2">None in OneSignal&apos;s history.</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    {n.recent.slice(0, 5).map((m) => (
                      <span key={m.id}>
                        {m.title ?? (m.kind === "api" ? "A message sent by the app" : "A message")}
                        <span className="c2">
                          {" "}
                          {m.sentAt ? <LocalTime iso={m.sentAt} style="relative" /> : null}: {m.totals.successful ?? 0} delivered, {m.totals.converted ?? 0} clicked
                          {(m.totals.errored ?? 0) > 0 ? `, ${m.totals.errored} errors` : ""}
                          {(m.totals.failed ?? 0) > 0 ? `, ${m.totals.failed} unsubscribed` : ""}
                        </span>
                      </span>
                    ))}
                  </span>
                )
              }
            </PartView>
          </Fact>
        </div>
      )}
    </article>
  );
}

const CRON_KINDS: Record<string, string> = {
  actions: "A GitHub Actions schedule",
  pg_cron: "A pg_cron schedule in the database",
  code: "A timer in the code",
  other: "A schedule",
};

const FIND_KINDS: Record<string, string> = {
  service: "Service",
  env: "Env name",
  cron: "Cron",
  webhook: "Webhook",
  store_app: "Store app",
  migration: "Migration source",
  deployment: "Deployable",
  other: "Other",
};

function CronLine({ cron }: { cron: CronRow }) {
  return (
    <div className="flex flex-col gap-1" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="t-body">
        <span className="t-mono-s">{cron.path}</span> <span className="c2">{cron.every}</span>
        {cron.perDay !== null && <span className="c3"> ({plural(cron.perDay, "run")} a day)</span>}
      </span>
      <span className="t-small c3">
        {cron.handler ? <span className="t-mono-s">{cron.handler}</span> : cron.kind === "vercel" ? "No handler found in the code" : (CRON_KINDS[cron.kind] ?? cron.kind)}
        {cron.handler && cron.kind === "vercel" ? (cron.checksSecret ? ", checks CRON_SECRET" : <span style={{ color: "var(--critical)" }}>, does not check CRON_SECRET</span>) : null}
        {cron.found ? (
          <>
            , found by the model, confirmed at{" "}
            <span className="t-mono-s">
              {cron.found.at.path}:{cron.found.at.line}
            </span>
          </>
        ) : null}
        {cron.projects.length > 0 &&
          `. ${cron.projects.map((p) => `${p.title}: ${p.registered === null ? "not read" : p.registered ? "registered" : "not registered"}`).join(", ")}`}
        .
      </span>
    </div>
  );
}

export function CockpitSections({ view, repoId }: { view: CockpitView; repoId: string }) {
  const base = `/app/${repoId}`;
  const shownAlerts = view.alerts.open.slice(0, 5);
  return (
    <div className="flex flex-col gap-14 max-[900px]:gap-10">
      <Section
        id="cockpit-alerts"
        title={view.alerts.open.length === 0 ? "Nothing needs you" : `${plural(view.alerts.open.length, "alert")} open`}
        intro={view.alerts.reason ?? `${view.alerts.critical > 0 ? `${plural(view.alerts.critical, "critical one", "critical ones")}. ` : ""}${view.alerts.email.sentence}`}
      >
        {shownAlerts.length > 0 && (
          <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
            {shownAlerts.map((a) => (
              <AlertItem key={a.id} alert={a} compact />
            ))}
          </div>
        )}
        <Link href={`${base}/alerts`} className="t-small c2 inline-flex items-center gap-1.5 self-start" style={{ minHeight: 32 }}>
          {view.alerts.open.length > shownAlerts.length ? `All ${view.alerts.open.length} open alerts, and the closed ones` : "The alert stream"}
          <ArrowRight {...icon14} />
        </Link>
      </Section>

      {view.undeclared.length > 0 && (
        <Link href={`${base}/projects`} className="panel flex items-center justify-between gap-4" style={{ padding: "14px 18px", textDecoration: "none" }}>
          <span className="t-body">
            The code uses {view.undeclared.map((u) => u.name).join(", ")}. <span className="c2">Add {view.undeclared.length === 1 ? "its project" : "their projects"} and a read key, and the cockpit reads {view.undeclared.length === 1 ? "it" : "them"} every hour.</span>
          </span>
          <span className="t-small c2 inline-flex items-center gap-1.5">
            Projects
            <ArrowRight {...icon14} />
          </span>
        </Link>
      )}

      {view.vercel.length > 0 && (
        <Section id="cockpit-deployments" title="Deployments" intro={view.map && view.map.roles.length > 1 ? `The code serves ${plural(view.map.roles.length, "deployment")} by ${view.map.roleEnv}: ${view.map.roles.join(", ")}. Each project is checked against the one its label names.` : undefined}>
          <div className="grid grid-cols-1 gap-4">
            {view.vercel.map((c) => (
              <VercelProject key={c.projectId} card={c} />
            ))}
          </div>
        </Section>
      )}

      {view.supabase.length > 0 && (
        <Section id="cockpit-database" title="Database">
          <div className="grid grid-cols-1 gap-4">
            {view.supabase.map((c) => (
              <SupabaseProject key={c.projectId} card={c} />
            ))}
          </div>
        </Section>
      )}

      {view.onesignal.length > 0 && (
        <Section id="cockpit-push" title="Push">
          <div className="grid grid-cols-1 gap-4">
            {view.onesignal.map((c) => (
              <OneSignalApp key={c.projectId} card={c} />
            ))}
          </div>
        </Section>
      )}

      {!view.map ? (
        <Section id="cockpit-map" title="From the code" intro={view.mapReason ?? "No service map yet."}>
          <span />
        </Section>
      ) : (
        <>
          <Section
            id="cockpit-services"
            title="Services"
            intro={
              <>
                {plural(view.services.length, "service")} found in the code
                {view.map.commit ? ` at commit ${shortSha(view.map.commit)}` : ""}, mapped <LocalTime iso={view.map.mappedAt} style="relative" />.
                {view.map.reader
                  ? ` The model (${view.map.reader.model}) read ${plural(view.map.reader.filesRead, "file")} and confirmed ${plural(view.map.reader.confirmed + view.map.reader.carried, "find")} at their lines.`
                  : " No model read the code for this map."}
              </>
            }
          >
            <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
              {view.services.map((s) => (
                <div key={s.slug} className="flex flex-wrap items-center justify-between gap-3" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="t-body" style={{ fontWeight: 600 }}>
                      {s.name}
                      {s.plan && <span className="tag" style={{ marginLeft: 8 }}>{s.plan}</span>}
                    </span>
                    {s.purpose ? (
                      <span className="t-small c2">
                        {s.purpose} <span className="c3">(as read by the model)</span>
                      </span>
                    ) : null}
                    <span className="t-small c3">
                      {s.found ? (
                        <>
                          Found by the model, confirmed at{" "}
                          <span className="t-mono-s">
                            {s.found.at.path}:{s.found.at.line}
                          </span>
                        </>
                      ) : (
                        <>
                          Found by {s.how.join(", ")}
                          {s.firstSeen ? (
                            <>
                              {", "}
                              <span className="t-mono-s">
                                {s.firstSeen.path}:{s.firstSeen.line}
                              </span>
                            </>
                          ) : null}
                        </>
                      )}
                      . {s.projects === 0 ? (s.readsInDepth ? "No project declared." : "Not read by birdsI yet.") : `${plural(s.projects, "project")}, ${s.keyed} with a key.`}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-3 t-small">
                    {s.dashboardUrl && <Out href={s.dashboardUrl}>Dashboard</Out>}
                    {s.pricingUrl && <Out href={s.pricingUrl}>Pricing</Out>}
                  </span>
                </div>
              ))}
            </div>
            {view.alsoFound.length > 0 && (
              <div className="flex flex-col gap-1" style={{ paddingTop: 12 }}>
                <span className="t-small c2">Also found by the model and confirmed at its line, with no part of the map to join yet:</span>
                {view.alsoFound.map((f) => (
                  <span key={`${f.kind}:${f.at.path}:${f.at.line}`} className="t-small c3">
                    {FIND_KINDS[f.kind] ?? f.kind}: {f.name}. {f.detail}{" "}
                    <span className="t-mono-s">
                      {f.at.path}:{f.at.line}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </Section>

          {view.crons.length > 0 && (
            <Section id="cockpit-crons" title="Crons">
              <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
                {view.crons.map((c) => (
                  <CronLine key={c.path} cron={c} />
                ))}
              </div>
            </Section>
          )}

          {view.webhooks.length > 0 && (
            <Section id="cockpit-webhooks" title="Webhooks">
              <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
                {view.webhooks.map((w) => (
                  <div key={w.route} className="flex flex-col gap-1" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                    <span className="t-body">
                      <span className="t-mono-s">{w.route}</span> <span className="c2">{w.service ? `from ${w.service}` : "sender not known"}</span>
                    </span>
                    <span className="t-small c3">
                      {w.verifies ? (
                        <>
                          Checks the sender at{" "}
                          <span className="t-mono-s">
                            {w.verifies.path}:{w.verifies.line}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: "var(--critical)" }}>No line that checks the sender was found in {w.file}</span>
                      )}
                      {w.found ? (
                        <>
                          , found by the model, confirmed at{" "}
                          <span className="t-mono-s">
                            {w.found.at.path}:{w.found.at.line}
                          </span>
                        </>
                      ) : null}
                      .
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {view.storeApps.length > 0 && (
            <Section id="cockpit-store" title="Store apps">
              <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
                {view.storeApps.map((a) => (
                  <div key={`${a.platform}-${a.bundleId}`} className="flex flex-col gap-1" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                    <span className="t-body">
                      {a.appName ?? "An app"} <span className="tag">{a.platform === "capacitor" ? "Capacitor" : a.platform === "ios" ? "iOS" : a.platform === "android" ? "Android" : "Expo"}</span>
                    </span>
                    <span className="t-small c3">
                      {a.bundleId ? <span className="t-mono-s">{a.bundleId}</span> : "No bundle id"}
                      {a.webUrl ? `, loads ${a.webUrl}` : ""}, from{" "}
                      <span className="t-mono-s">
                        {a.source.path}:{a.source.line}
                      </span>
                      .
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {view.migrations && view.migrations.files > 0 && (
            <Section id="cockpit-migrations" title="Migrations">
              <p className="t-small c2" style={{ maxWidth: 760 }}>
                {plural(view.migrations.files, "migration file")} in <span className="t-mono-s">{view.migrations.dir ?? "the repository"}</span>
                {view.migrations.latest ? (
                  <>
                    , the latest <span className="t-mono-s">{view.migrations.latest}</span>
                  </>
                ) : null}
                .{" "}
                {view.migrations.verify ? (
                  <>
                    {plural(view.migrations.verify.markers, "marker")} in <span className="t-mono-s">{view.migrations.verify.path}</span>, checked against each Supabase project above.
                  </>
                ) : (
                  "No verify.sql with markers, so which ran can only be read from a Supabase CLI history."
                )}
              </p>
            </Section>
          )}

          {view.publicSurface && (
            <Section id="cockpit-public" title="Public pages">
              <p className="t-small c2">
                {[
                  ["Sitemap", view.publicSurface.sitemap],
                  ["Robots", view.publicSurface.robots],
                  ["llms.txt", view.publicSurface.llmsTxt],
                ]
                  .map(([name, line]) => (line && typeof line === "object" ? `${name}: ${line.path}` : `${name}: none`))
                  .join(". ")}
                .
              </p>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
