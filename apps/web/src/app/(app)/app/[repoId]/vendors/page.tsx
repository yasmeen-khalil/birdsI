import Link from "next/link";
import type { Metadata } from "next";
import type { VendorCategory } from "@birdsi/shared";
import { LocalTime } from "@/components/LocalTime";
import { ScanAgainButton } from "@/components/ScanActions";
import { plural } from "@/components/format";
import { AlertList, CATEGORY_LABEL, usd, WatchList } from "@/components/ops/OpsParts";
import { RefreshVendorsButton } from "@/components/ops/RefreshVendors";
import { VendorCard } from "@/components/ops/VendorCard";
import { recentScans, repoContext, runningOf } from "@/components/server/data";
import { loadVendors } from "@/lib/ops";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { user, repo } = await repoContext(repoId);
  const [data, scans] = await Promise.all([loadVendors(repo.id, user), recentScans(repo.id)]);
  const running = runningOf(scans);
  const { vendors, alerts, watches, runways, monthlyUsd } = data;

  const counts = new Map<VendorCategory, number>();
  for (const v of vendors) counts.set(v.category, (counts.get(v.category) ?? 0) + 1);
  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1] || CATEGORY_LABEL[a[0]].localeCompare(CATEGORY_LABEL[b[0]]));
  const connected = vendors.filter((v) => v.connected).length;
  const connectable = vendors.filter((v) => v.connectable && !v.connected).length;
  const sorted = [...vendors].sort((a, b) => Number(b.connected) - Number(a.connected) || b.facts.length - a.facts.length || a.name.localeCompare(b.name));

  return (
    <main className="flex flex-col gap-12 px-16 pt-12 pb-16 max-[900px]:gap-10 max-[900px]:px-5 max-[900px]:pt-7 max-[900px]:pb-10">
      <section className="flex flex-col justify-between gap-5 min-[901px]:flex-row min-[901px]:items-end min-[901px]:gap-10">
        <div className="flex min-w-0 flex-col gap-2.5" style={{ maxWidth: 720 }}>
          <h1 className="t-h1">Vendors</h1>
          <p className="t-body c2">
            Vendors are the outside services this app runs on: hosting, database, payments, email. Each with what its account says, and the plan&apos;s limits from birdsI&apos;s checked list.{" "}
            {data.lastSyncAt ? (
              <>
                Last read <LocalTime iso={data.lastSyncAt} />.
              </>
            ) : (
              "Not read yet."
            )}
          </p>
        </div>
        {vendors.length > 0 && <RefreshVendorsButton repoId={repo.id} running={data.syncRunning} />}
      </section>

      {vendors.length === 0 ? (
        <div className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px", maxWidth: 560 }}>
          <h2 className="t-h2" style={{ fontSize: 23 }}>
            No vendors found yet
          </h2>
          <p className="t-small c2">Map the code. birdsI finds every service it calls from the packages, env names, addresses and config files, in about a minute.</p>
          <div className="flex justify-end">
            <ScanAgainButton repoId={repo.id} label={running ? "A map is running" : "Map the code"} disabled={Boolean(running)} />
          </div>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-y-6 min-[901px]:grid-cols-12 min-[901px]:gap-x-6" aria-label="Summary">
            <div className="flex flex-col gap-1.5 min-[901px]:col-span-5">
              <span className="t-label c3">Spend read this month</span>
              {monthlyUsd !== null ? (
                <p className="t-display max-[900px]:text-[34px]!" style={{ fontSize: 44 }}>
                  {usd(monthlyUsd)}
                  <span className="t-body c2" style={{ fontFamily: "var(--sans)" }}>
                    {" "}
                    so far, from the accounts that report it
                  </span>
                </p>
              ) : (
                <p className="t-body c2" style={{ maxWidth: 420 }}>
                  No account has reported spend yet. Plan prices are on each vendor below and are never added in.
                </p>
              )}
              <p className="t-small c3">
                {connected === 0 ? "No accounts connected." : `${plural(connected, "account")} connected.`}{" "}
                {connectable > 0 ? (
                  <>
                    <Link href="/settings#connected-accounts" className="c2">
                      Connect {connectable === 1 ? "one more" : `${connectable} more`}
                    </Link>{" "}
                    so birdsI reads spend and usage from the account.
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex flex-col gap-2.5 min-[901px]:col-span-6 min-[901px]:col-start-7">
              <span className="t-label c3">By category</span>
              <div className="flex flex-wrap gap-2">
                {categories.map(([c, n]) => (
                  <span key={c} className="tag" style={{ height: 28, padding: "0 10px", gap: 8 }}>
                    {CATEGORY_LABEL[c]}
                    <b style={{ color: "var(--text)" }}>{n}</b>
                  </span>
                ))}
              </div>
            </div>
          </section>

          {alerts.length > 0 && (
            <section className="flex flex-col gap-4" aria-labelledby="alerts-title">
              <h2 id="alerts-title" className="t-h2 max-[900px]:text-[24px]!">
                Alerts
              </h2>
              <AlertList alerts={alerts} />
            </section>
          )}

          {watches.length > 0 && (
            <section className="flex flex-col gap-4" aria-labelledby="tracking-title">
              <div className="flex flex-col gap-1.5">
                <h2 id="tracking-title" className="t-h2 max-[900px]:text-[24px]!">
                  Tracking
                </h2>
                <p className="t-body c2" style={{ maxWidth: 720 }}>
                  Things that might happen, not problems now: a free plan that pauses, a trial that ends. birdsI alerts you only if one happens.
                </p>
              </div>
              <WatchList watches={watches} />
            </section>
          )}

          <section className="flex flex-col gap-4" aria-labelledby="list-title">
            <h2 id="list-title" className="t-h2 max-[900px]:text-[24px]!">
              {plural(vendors.length, "vendor")}
            </h2>
            <div className="flex flex-col gap-4">
              {sorted.map((v) => (
                <VendorCard key={v.id} vendor={v} watches={watches.filter((w) => w.vendorId === v.id)} runways={runways[v.id] ?? []} />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
