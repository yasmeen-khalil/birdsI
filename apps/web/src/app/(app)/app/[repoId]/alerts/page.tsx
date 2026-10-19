import Link from "next/link";
import type { Metadata } from "next";
import { ALERT_KIND_LABEL, AppAlertKind, type AppAlert } from "@birdsi/shared";
import { AlertFilterLink, AlertItem } from "@/components/alerts/AlertStream";
import { plural } from "@/components/format";
import { repoContext } from "@/components/server/data";
import { loadAlerts } from "@/lib/cockpit";

export const metadata: Metadata = { title: "Alerts" };

type Show = "open" | "closed" | "all";

export default async function AlertsPage({ params, searchParams }: { params: Promise<{ repoId: string }>; searchParams: Promise<{ show?: string; kind?: string }> }) {
  const { repoId } = await params;
  const query = await searchParams;
  const { user, repo } = await repoContext(repoId);
  const data = await loadAlerts(repo.id, user);
  const show: Show = query.show === "closed" || query.show === "all" ? query.show : "open";
  const kind = AppAlertKind.safeParse(query.kind).success ? (query.kind as AppAlert["kind"]) : null;

  const open = data.alerts.filter((a) => !a.resolvedAt);
  const closed = data.alerts.filter((a) => a.resolvedAt);
  const pool = show === "open" ? open : show === "closed" ? closed : data.alerts;
  const kinds = [...new Set(pool.map((a) => a.kind))];
  const shown = pool.filter((a) => !kind || a.kind === kind);
  const href = (next: { show?: Show; kind?: string | null }) => {
    const p = new URLSearchParams();
    const s = next.show ?? show;
    const k = next.kind === undefined ? kind : next.kind;
    if (s !== "open") p.set("show", s);
    if (k) p.set("kind", k);
    const q = p.toString();
    return `/app/${repo.id}/alerts${q ? `?${q}` : ""}`;
  };

  return (
    <main className="flex flex-col gap-10 px-16 pt-12 pb-16 max-[900px]:gap-8 max-[900px]:px-5 max-[900px]:pt-7 max-[900px]:pb-10">
      <section className="flex flex-col gap-2.5" style={{ maxWidth: 760 }}>
        <h1 className="t-h1">Alerts</h1>
        <p className="t-body c2">
          What needs you across this app, from its code and its vendors, newest first. Each alert closes by itself when a later read no longer finds its cause. {data.email.sentence}{" "}
          {!data.email.on && (
            <Link href="/settings" className="c2">
              Settings
            </Link>
          )}
        </p>
      </section>

      {data.reason ? (
        <section className="panel flex flex-col gap-3" style={{ padding: "22px 24px", maxWidth: 600 }}>
          <h2 className="t-h2" style={{ fontSize: 23 }}>
            No alerts kept yet
          </h2>
          <p className="t-small c2">{data.reason}</p>
        </section>
      ) : (
        <>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Show">
            <AlertFilterLink href={href({ show: "open", kind: null })} on={show === "open"}>
              Open {open.length}
            </AlertFilterLink>
            <AlertFilterLink href={href({ show: "closed", kind: null })} on={show === "closed"}>
              Closed {closed.length}
            </AlertFilterLink>
            <AlertFilterLink href={href({ show: "all", kind: null })} on={show === "all"}>
              All {data.alerts.length}
            </AlertFilterLink>
            {kinds.length > 1 && <span className="c3" aria-hidden="true">·</span>}
            {kinds.length > 1 &&
              kinds.map((k) => (
                <AlertFilterLink key={k} href={href({ kind: kind === k ? null : k })} on={kind === k}>
                  {ALERT_KIND_LABEL[k]}
                </AlertFilterLink>
              ))}
          </nav>

          {shown.length === 0 ? (
            <section className="panel flex flex-col gap-2" style={{ padding: "22px 24px", maxWidth: 600 }}>
              <h2 className="t-h2" style={{ fontSize: 23 }}>
                {show === "open" ? "Nothing needs you" : "Nothing here"}
              </h2>
              <p className="t-small c2">
                {show === "open"
                  ? "No open alert. The worker reads the projects every hour and after every map, and an alert opens the moment a read finds a cause."
                  : "No alert matches this filter in the last two weeks."}
              </p>
            </section>
          ) : (
            <section aria-label="Alerts" className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
              <p className="t-small c3" style={{ padding: "10px 0" }}>
                {plural(shown.length, "alert")}
                {show !== "closed" && shown.some((a) => !a.resolvedAt && a.severity === "critical") ? `, ${plural(shown.filter((a) => !a.resolvedAt && a.severity === "critical").length, "critical one", "critical ones")}` : ""}.
              </p>
              {shown.map((a) => (
                <AlertItem key={a.id} alert={a} />
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
