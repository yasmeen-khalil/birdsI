import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { latestServiceMap, vendorsForRepo } from "@birdsi/db";
import { DeadlineControls } from "@/components/alerts/DeadlineControls";
import { EntryControls } from "@/components/alerts/EntryControls";
import { PROJECT_VENDORS, PROJECT_VENDOR_BY_SLUG, type AppProject } from "@birdsi/shared";
import { AddProjectForm, AppNameForm, EnvironmentsForm, ProjectActions, ProjectDetailsForm, TieKeyControl, type VendorChoice } from "@/components/apps/ProjectControls";
import { LocalTime } from "@/components/LocalTime";
import { safeUrl } from "@/components/format";
import { icon14 } from "@/components/icon";
import { repoContext } from "@/components/server/data";
import { loadApp } from "@/lib/apps";
import { loadAlerts, loadEntries } from "@/lib/cockpit";

export const metadata: Metadata = { title: "Projects and keys" };

const VENDOR_CHOICES: VendorChoice[] = PROJECT_VENDORS.map((v) => ({
  vendor: v.vendor,
  name: v.name,
  reads: v.reads,
  keyHint: v.keyHint,
  keyUrl: v.keyUrl,
  kinds: v.kinds.map((k) => ({ kind: k.kind, refLabel: k.refLabel, refHint: k.refHint })),
  settings: v.settings,
}));

function vendorName(slug: string): string {
  return PROJECT_VENDOR_BY_SLUG.get(slug)?.name ?? slug;
}

function KeyStatus({ project }: { project: AppProject }) {
  const reads = PROJECT_VENDOR_BY_SLUG.get(project.vendor)?.reads ?? false;
  const key = project.key;
  if (!reads) return <span className="t-small c3">birdsI cannot read {vendorName(project.vendor)} yet, so it holds no key. The link opens the project in its dashboard.</span>;
  if (!key) return <span className="t-small c2">No key yet. birdsI cannot read this project until it has one.</span>;
  return (
    <span className="flex flex-col gap-1">
      <span className="t-small inline-flex flex-wrap items-center gap-2">
        {key.lastStatus === "failed" ? <span className="tag bad">Could not read</span> : key.lastStatus === "ok" ? <span className="tag ok">Reading</span> : <span className="tag">Not read yet</span>}
        <span className="c2">
          Read key{key.label ? `, ${key.label}` : ""}
          {key.fingerprint ? (
            <>
              {", "}
              <span className="t-mono-s">{key.fingerprint}</span>
            </>
          ) : null}
          . Connected <LocalTime iso={key.createdAt} style="relative" />
          {key.lastReadAt ? (
            <>
              , last read <LocalTime iso={key.lastReadAt} style="relative" />
            </>
          ) : null}
          .
        </span>
      </span>
      {key.sharedWith.length > 0 && <span className="t-small c3">The same key reads {key.sharedWith.join(", ")}.</span>}
      {key.lastStatus === "failed" && key.lastError && (
        <span className="t-small" style={{ color: "var(--critical)" }}>
          {key.lastError}
        </span>
      )}
    </span>
  );
}

export default async function ProjectsPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { user, repo } = await repoContext(repoId);
  const [{ app, untiedKeys }, vendors, stored, alertData, entriesData] = await Promise.all([loadApp(repo.id, user), vendorsForRepo(repo.id), latestServiceMap(repo.id).catch(() => null), loadAlerts(repo.id, user), loadEntries(repo.id, user)]);
  const roles = stored?.map.roles ?? null;

  if (!app) {
    return (
      <main className="flex flex-col gap-8 px-16 pt-12 pb-16 max-[900px]:px-5 max-[900px]:pt-7">
        <h1 className="t-h1">Projects and keys</h1>
        <section className="panel flex flex-col gap-3" style={{ padding: "22px 24px", maxWidth: 600 }}>
          <h2 className="t-h2" style={{ fontSize: 23 }}>
            Waiting on a migration
          </h2>
          <p className="t-small c2">
            Apps, their vendor projects and a key per project switch on when the migration <span className="t-mono">20261018000100_apps_projects.sql</span> has run in the Supabase SQL editor. Until then, keys connect once per vendor in Settings, the way they did before.
          </p>
          <div className="flex justify-end">
            <Link className="btn btn-secondary btn-sm" href="/settings#connected-accounts">
              Open Settings
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const detected = new Set(vendors.map((v) => v.slug));
  const declared = new Set(app.projects.map((p) => p.vendor));
  const suggested = PROJECT_VENDORS.filter((v) => detected.has(v.vendor) && !declared.has(v.vendor)).map((v) => v.vendor);
  const groups = [...new Set(app.projects.map((p) => p.vendor))].sort((a, b) => vendorName(a).localeCompare(vendorName(b)));
  const untiedHere = untiedKeys;

  return (
    <main className="flex flex-col gap-12 px-16 pt-12 pb-16 max-[900px]:gap-10 max-[900px]:px-5 max-[900px]:pt-7 max-[900px]:pb-10">
      <section className="flex flex-col gap-2.5" style={{ maxWidth: 760 }}>
        <h1 className="t-h1">Projects and keys</h1>
        <p className="t-body c2">
          The vendor projects {app.name} runs on, and the key birdsI reads each one with. Keys only read, are checked with the vendor before they are stored, are kept encrypted, and are never shown again.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-8 min-[901px]:grid-cols-2" aria-label="The app">
        <AppNameForm repoId={repo.id} name={app.name} />
        <EnvironmentsForm repoId={repo.id} environments={app.environments} />
      </section>

      {untiedHere.length > 0 && (
        <section className="flex flex-col gap-4" aria-labelledby="untied-title">
          <div className="flex flex-col gap-1.5">
            <h2 id="untied-title" className="t-h2 max-[900px]:text-[24px]!">
              Keys not tied to a project yet
            </h2>
            <p className="t-body c2" style={{ maxWidth: 720 }}>
              You connected these before keys belonged to a project. birdsI still reads them the old way. Tie each one to the project it reads.
            </p>
          </div>
          <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
            {untiedHere.map((k) => (
              <div key={k.id} className="flex flex-col gap-2.5" style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
                <span className="t-body" style={{ fontWeight: 600 }}>
                  {k.vendorName}
                  {Object.keys(k.settings).length > 0 && (
                    <span className="t-mono-s c3" style={{ fontWeight: 400, marginLeft: 8 }}>
                      {Object.entries(k.settings)
                        .map(([name, value]) => `${name} ${value}`)
                        .join(", ")}
                    </span>
                  )}
                </span>
                <TieKeyControl repoId={repo.id} untied={k} projects={app.projects.filter((p) => p.vendor === k.vendor && !p.key).map((p) => ({ id: p.id, label: p.label ?? p.ref }))} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-6" aria-labelledby="projects-title">
        <div className="flex flex-col gap-1.5">
          <h2 id="projects-title" className="t-h2 max-[900px]:text-[24px]!">
            {app.projects.length === 0 ? "No projects yet" : "Projects"}
          </h2>
          {app.projects.length === 0 && (
            <p className="t-body c2" style={{ maxWidth: 720 }}>
              Add each vendor project this app has: one Vercel project per deployment (the product and the ops one), the Supabase project, the OneSignal app, and the rest. {suggested.length > 0 ? `The code uses ${suggested.map(vendorName).join(", ")}, so those come first.` : ""}
            </p>
          )}
          {roles && roles.names.length > 1 && (
            <p className="t-small c2" style={{ maxWidth: 720 }}>
              The code serves {roles.names.length} deployments, chosen by <span className="t-mono-s">{roles.envName}</span>: {roles.names.join(", ")}. Label each Vercel project with the deployment it serves, such as {roles.names.filter((n) => n !== roles.defaultRole).join(" or ")}, and the cockpit checks its env names against what that deployment needs. Any other label is checked as {roles.defaultRole ?? "the product"}, the deployment when <span className="t-mono-s">{roles.envName}</span> is unset.
            </p>
          )}
        </div>
        {groups.map((vendor) => {
          const projects = app.projects.filter((p) => p.vendor === vendor);
          const reusable = app.projects.filter((p) => p.vendor === vendor && p.key).map((p) => ({ connectionId: p.key!.id, label: p.label ?? p.ref }));
          return (
            <div key={vendor} className="flex flex-col" role="group" aria-label={vendorName(vendor)}>
              <div className="ghead">
                <span className="t-label">{vendorName(vendor)}</span>
                <span className="t-small c3">{projects.length}</span>
              </div>
              {projects.map((p) => {
                const link = safeUrl(p.dashboardUrl);
                return (
                  <div key={p.id} className="flex flex-col gap-3" style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="t-body inline-flex flex-wrap items-center gap-2" style={{ fontWeight: 600 }}>
                          {p.label ?? p.ref}
                          {p.environment && <span className="tag">{p.environment}</span>}
                          {p.plan && <span className="tag">{p.plan} plan, as you said</span>}
                        </span>
                        <span className="t-mono-s c3 break-all">
                          {p.kind} {p.ref}
                          {Object.entries(p.settings).map(([name, value]) => `, ${name} ${value}`)}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ProjectDetailsForm repoId={repo.id} project={p} />
                        {link && (
                          <a className="btn btn-quiet btn-sm" href={link} target="_blank" rel="noreferrer" style={{ minHeight: 32, fontSize: 13 }}>
                            Open
                            <ExternalLink {...icon14} />
                          </a>
                        )}
                      </span>
                    </div>
                    <KeyStatus project={p} />
                    <ProjectActions repoId={repo.id} project={p} vendor={VENDOR_CHOICES.find((v) => v.vendor === p.vendor) ?? null} reusable={reusable.filter((r) => r.connectionId !== p.key?.id)} />
                  </div>
                );
              })}
            </div>
          );
        })}
        <AddProjectForm repoId={repo.id} vendors={VENDOR_CHOICES} suggested={suggested} />
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="dates-title" style={{ maxWidth: 820 }}>
        <div className="flex flex-col gap-1.5">
          <h2 id="dates-title" className="t-h2 max-[900px]:text-[24px]!">
            Dates to watch
          </h2>
          <p className="t-body c2" style={{ maxWidth: 720 }}>
            Dates no vendor reports through its API: a trial that ends, a credit that runs out. The alerts warn from 30 days before, and the alert stays until two weeks after.
          </p>
        </div>
        {alertData.reason ? (
          <p className="t-small c3">{alertData.reason}</p>
        ) : (
          <DeadlineControls repoId={repo.id} deadlines={alertData.deadlines} vendors={vendors.map((v) => ({ slug: v.slug, name: v.name })).sort((a, b) => a.name.localeCompare(b.name))} />
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="entries-title" style={{ maxWidth: 820 }}>
        <div className="flex flex-col gap-1.5">
          <h2 id="entries-title" className="t-h2 max-[900px]:text-[24px]!">
            What no API reports
          </h2>
          <p className="t-body c2" style={{ maxWidth: 720 }}>
            Subscriptions, fees and credits birdsI cannot read with any key: the Apple Developer fee, a push plan paid for the year, a cloud credit. Each counts in the money section, marked as entered by you and kept apart from what is read, and a renewal date warns like a date to watch.
          </p>
        </div>
        {entriesData.reason ? <p className="t-small c3">{entriesData.reason}</p> : <EntryControls repoId={repo.id} entries={entriesData.entries} vendors={vendors.map((v) => ({ slug: v.slug, name: v.name })).sort((a, b) => a.name.localeCompare(b.name))} />}
      </section>
    </main>
  );
}
