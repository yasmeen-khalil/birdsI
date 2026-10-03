import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SignOutButton } from "@clerk/nextjs";
import { ExternalLink, LogOut, Plus } from "lucide-react";
import { latestDoneScan, tokensForUser, toScan, usageForUser } from "@birdsi/db";
import { LocalTime } from "@/components/LocalTime";
import { ConnectAccount, DeleteAccount, DisconnectAccount, DisconnectRepo, EmailToggle, RevokeToken } from "@/components/SettingsControls";
import { TopBar } from "@/components/shell/TopBar";
import { initials, KIND_LABEL, plural, repoName } from "@/components/format";
import { icon } from "@/components/icon";
import { appUser, toOption, userRepos } from "@/components/server/data";
import { connectorCatalog, listConnections } from "@/lib/ops";

export const metadata: Metadata = { title: "Settings" };

function Section({ id, title, muted = false, last = false, children }: { id?: string; title: string; muted?: boolean; last?: boolean; children: ReactNode }) {
  return (
    <section id={id} className="grid grid-cols-1 gap-y-4 min-[901px]:grid-cols-12 min-[901px]:gap-x-6" style={{ padding: "36px 0", borderTop: "1px solid var(--line)", ...(last ? { borderBottom: "1px solid var(--line)" } : {}) }}>
      <h2 className={`t-h3 min-[901px]:col-span-3${muted ? " c2" : ""}`} style={muted ? { fontWeight: 500 } : undefined}>
        {title}
      </h2>
      <div className="flex min-w-0 flex-col gap-[18px] min-[901px]:col-span-7 min-[901px]:col-start-4">{children}</div>
    </section>
  );
}

function amount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")} million`;
  if (n >= 10_000) return `${Math.round(n / 1000)} thousand`;
  return n.toLocaleString("en-US");
}

export default async function SettingsPage() {
  const user = await appUser();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [repos, tokens, usage, connections] = await Promise.all([userRepos(user.id), tokensForUser(user.id), usageForUser(user.id, monthStart), listConnections(user)]);
  const catalog = connectorCatalog().map((c) => ({ slug: c.slug, name: c.name, tokenHint: c.tokenHint, tokenUrl: c.tokenUrl, fields: c.fields.map((f) => ({ key: f.key, label: f.label, hint: f.hint, required: f.required })) }));
  const lastScans = await Promise.all(repos.map(async (r) => {
    const row = await latestDoneScan(r.id);
    return row ? toScan(row) : null;
  }));
  const liveTokens = tokens.filter((t) => !t.revoked_at);
  const login = user.github_login ?? user.email ?? "";

  return (
    <>
      <TopBar login={login} repos={repos.map(toOption)} current={null} settingsActive />
      <main className="flex flex-col px-16 pt-12 pb-12 max-[900px]:px-5 max-[900px]:pt-7">
        <h1 className="t-h1" style={{ paddingBottom: 36 }}>
          Settings
        </h1>

        <Section title="Account">
          <div className="flex items-center gap-3.5">
            <span className="avatar" style={{ width: 44, height: 44, lineHeight: "42px", fontSize: 14 }} aria-hidden="true">
              {initials(login)}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="t-body truncate" style={{ fontWeight: 600 }}>
                {user.github_login ?? user.email ?? "Your account"}
              </span>
              <span className="t-small c2">{user.github_login ? `Signed in with GitHub as ${user.github_login}` : "Signed in with GitHub"}</span>
            </span>
          </div>
          <EmailToggle initial={user.email_updates} />
        </Section>

        <Section title="Repositories">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="t-small c2">birdsI reads these through its GitHub App or from your terminal.</p>
            <Link className="btn btn-secondary btn-sm" href="/connect">
              <Plus {...icon} />
              Add a repository
            </Link>
          </div>
          {repos.length === 0 ? (
            <p className="t-small c3" style={{ padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
              No repositories connected yet.
            </p>
          ) : (
            <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
              {repos.map((r, i) => {
                const s = lastScans[i];
                const n = s?.summary ? Object.values(s.summary.bySeverity).reduce((a, b) => a + b, 0) : 0;
                return (
                  <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4" style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="t-body truncate" style={{ fontWeight: 600 }}>
                        {repoName(r.full_name)}
                      </span>
                      <span className="t-small c2">
                        {r.source === "local" ? "Uploaded from your terminal. " : ""}
                        {s ? (
                          <>
                            Last {KIND_LABEL[s.kind].toLowerCase()} <LocalTime iso={s.finishedAt} />. {plural(n, "finding")}.
                          </>
                        ) : (
                          "Not scanned yet."
                        )}
                      </span>
                      <DisconnectRepo repoId={r.id} name={repoName(r.full_name)} />
                    </span>
                    <Link className="btn btn-quiet btn-sm" href={`/app/${r.id}`} style={{ minHeight: 44 }}>
                      Open
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
          <a className="t-small c2 inline-flex items-center gap-1.5" href="https://github.com/settings/installations" target="_blank" rel="noreferrer">
            Change which repositories birdsI can read on GitHub
            <ExternalLink {...icon} />
          </a>
        </Section>

        <Section id="connected-accounts" title="Connected accounts">
          <p className="t-small c2">Connect a vendor account with a read-only token, a key that can look but not change. birdsI reads the plan, usage and spend, and alerts you near a limit.</p>
          {connections.length === 0 ? (
            <p className="t-small c3" style={{ padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
              No accounts connected yet.
            </p>
          ) : (
            <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
              {connections.map((c) => (
                <div key={c.id} className="flex flex-col gap-1" style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
                  <span className="flex flex-wrap items-center gap-2.5">
                    <span className="t-body" style={{ fontWeight: 600 }}>
                      {c.name}
                    </span>
                    {c.lastStatus === "failed" ? <span className="tag bad">Could not read</span> : c.lastStatus === "ok" ? <span className="tag ok">Working</span> : <span className="tag">Not checked yet</span>}
                  </span>
                  <span className="t-small c2">
                    Connected <LocalTime iso={c.createdAt} style="relative" />. {c.lastProbedAt ? <>Last checked <LocalTime iso={c.lastProbedAt} style="relative" />.</> : null}
                  </span>
                  {c.lastStatus === "failed" && c.lastError && (
                    <span className="t-small" style={{ color: "var(--critical)" }}>
                      {c.lastError}
                    </span>
                  )}
                  <DisconnectAccount connectionId={c.id} name={c.name} />
                </div>
              ))}
            </div>
          )}
          <ConnectAccount catalog={catalog} connected={connections.map((c) => c.vendorSlug)} />
          <p className="t-small c3">Tokens are encrypted on birdsI&apos;s servers and used only to read that account. Use read-only tokens where offered.</p>
        </Section>

        <Section title="Terminal and MCP">
          <p className="t-small c2">
            Each sign-in from the terminal tool creates a token. Your coding agent uses the same token through <span className="t-mono">npx birdsi mcp</span>.
          </p>
          {liveTokens.length === 0 ? (
            <p className="t-small c3" style={{ padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
              No tokens yet. Run <span className="t-mono c2">npx birdsi login</span> in your project folder to sign in from the terminal.
            </p>
          ) : (
            <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
              {liveTokens.map((t) => {
                const expired = t.expires_at ? new Date(t.expires_at) < new Date() : false;
                return (
                  <div key={t.id} className="flex flex-col gap-1" style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
                    <span className="t-body" style={{ fontWeight: 600 }}>
                      {t.name}
                    </span>
                    <span className="t-small c2">
                      Created <LocalTime iso={t.created_at} style="relative" />. {t.last_used_at ? <>Last used <LocalTime iso={t.last_used_at} style="relative" />.</> : "Not used yet."}{" "}
                      {t.expires_at ? expired ? "Expired." : <>Expires <LocalTime iso={t.expires_at} style="date" />.</> : null}
                    </span>
                    <RevokeToken tokenId={t.id} name={t.name} />
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Usage this month">
          {usage.calls === 0 ? (
            <p className="t-small c2">No model calls yet this month.</p>
          ) : (
            <p className="t-body c2">
              birdsI made {plural(usage.calls, "model call")} for you this month. The models read {amount(usage.inputTokens)} tokens of your code and questions, and wrote {amount(usage.outputTokens)}. A token is a short piece of a word.
            </p>
          )}
          <p className="t-small c3">Fair-use limits keep scans open for everyone. If you reach one, birdsI tells you when scans open again.</p>
        </Section>

        <Section title="Session">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4" style={{ padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
            <span className="t-body">Sign out of birdsI on this browser</span>
            <SignOutButton redirectUrl="/">
              <button type="button" className="btn btn-secondary btn-sm">
                <LogOut {...icon} />
                Sign out
              </button>
            </SignOutButton>
          </div>
        </Section>

        <Section title="Delete account" muted last>
          <p className="t-small c2" style={{ maxWidth: 560 }}>
            Removes your findings, scans, vendor details, questions and chats from birdsI, and disconnects every repository. Your code on GitHub is not touched.
          </p>
          <DeleteAccount expected={login} repoCount={repos.length} />
        </Section>
      </main>
    </>
  );
}
