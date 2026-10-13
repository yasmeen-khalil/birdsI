import Link from "next/link";
import type { Metadata } from "next";
import { Check, CircleAlert, ExternalLink } from "lucide-react";
import { installationsForUser, scansForRepo } from "@birdsi/db";
import { ConnectForm } from "@/components/ConnectForm";
import { CopyButton } from "@/components/CopyButton";
import { Wordmark } from "@/components/Wordmark";
import { initials, plural } from "@/components/format";
import { icon } from "@/components/icon";
import { appUser, userRepos } from "@/components/server/data";
import { installUrl } from "@/lib/github";

export const metadata: Metadata = { title: "Connect a repository" };

const INSTALLATIONS_URL = "https://github.com/settings/installations";

function Banner({ tone, title, children }: { tone: "ok" | "error" | "info"; title: string; children?: React.ReactNode }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "error" ? "var(--critical)" : "var(--text-2)";
  return (
    <div className="panel grid grid-cols-[24px_minmax(0,1fr)] gap-x-3" style={{ padding: "16px 20px" }} role={tone === "error" ? "alert" : "status"}>
      {tone === "ok" ? <Check {...icon} style={{ color, marginTop: 3 }} /> : <CircleAlert {...icon} style={{ color, marginTop: 3 }} />}
      <div className="flex flex-col gap-1">
        <span className="t-body" style={{ fontWeight: 600 }}>
          {title}
        </span>
        {children && <span className="t-small c2">{children}</span>}
      </div>
    </div>
  );
}

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ status?: string; count?: string }> }) {
  const { status, count } = await searchParams;
  const user = await appUser();
  const [installations, repos] = await Promise.all([installationsForUser(user.id), userRepos(user.id)]);
  const install = installUrl(user.id);
  const active = installations.filter((i) => !i.suspended_at);
  const scanned = await Promise.all(repos.map(async (r) => (await scansForRepo(r.id, 1)).length > 0));
  const connectedCount = Number.parseInt(count ?? "", 10);

  return (
    <>
      <header className="topbar">
        <Wordmark href={repos[0] ? `/app/${repos[0].id}` : "/"} />
        <ol className="t-small flex items-center gap-8 max-[900px]:hidden" style={{ listStyle: "none", margin: "0 auto", padding: 0 }} aria-label="Getting started">
          <li className="inline-flex items-center gap-2" style={{ color: "var(--text-3)" }}>
            <Check {...icon} />
            1. Sign in
          </li>
          <li className="inline-flex items-center gap-2" style={{ color: "var(--text)", fontWeight: 600 }} aria-current="step">
            <span className="dot" style={{ background: "var(--accent)" }} />
            2. Add a repository
          </li>
          <li className="inline-flex items-center gap-2" style={{ color: "var(--text-3)" }}>
            3. First scan
          </li>
        </ol>
        <span className="t-small c2 min-[901px]:hidden" style={{ marginLeft: "auto" }}>
          Step 2 of 3
        </span>
        <span className="tag">Demo</span>
        <Link className="avatar" href="/settings" aria-label="Settings" style={{ textDecoration: "none" }}>
          {initials(user.github_login ?? user.email)}
        </Link>
      </header>
      <main className="grid flex-grow grid-cols-1 gap-y-10 px-16 pt-[72px] pb-12 max-[900px]:px-5 max-[900px]:pt-8 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
        <section className="flex flex-col gap-5 min-[901px]:col-span-5">
          <h1 className="t-h1">Add a repository</h1>
          <p className="t-body-l c2">Run birdsI in the project folder on your computer. It uploads the code (everything your .gitignore leaves out stays with you), runs a quick check, and opens the repository here.</p>
          <div className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px" }}>
            <h2 className="t-h3">From your terminal</h2>
            <div className="code">
              <div className="hd">
                <span>Two commands, once</span>
                <CopyButton text={"npx birdsi login\nnpx birdsi"} label="Copy" />
              </div>
              <div className="bd" style={{ padding: "10px 14px" }}>
                <div>npx birdsi login</div>
                <div>npx birdsi</div>
              </div>
            </div>
            <p className="t-small c2">Sign in once with a code shown in your terminal. After that, npx birdsi in any project folder is all it takes. Add --full for the full scan.</p>
            <p className="t-small c3">
              Until the package is on npm, run it from a clone: <span className="t-mono">npm install</span>, then <span className="t-mono">npx tsx packages/cli/src/birdsi.ts</span>.
            </p>
          </div>

          {status === "connected" && (
            <Banner tone="ok" title={Number.isFinite(connectedCount) && connectedCount > 0 ? `${plural(connectedCount, "repository", "repositories")} connected` : "The GitHub App is installed"}>
              {Number.isFinite(connectedCount) && connectedCount > 0 ? "Choose one and start its first scan." : "No repositories are shared with it yet. Choose some on GitHub."}
            </Banner>
          )}
          {status === "requested" && (
            <Banner tone="info" title="Your request was sent">
              An owner of the GitHub organization needs to approve the birdsI app. Once they do, its repositories appear here.
            </Banner>
          )}
          {status === "missing" && (
            <Banner tone="error" title="GitHub did not send the installation back">
              Nothing was connected. Install the app again from the button below.
            </Banner>
          )}
          {status === "unconfirmed" && (
            <Banner tone="error" title="birdsI could not confirm this installation came from you">
              Nothing was connected. Start the installation from the button below, so birdsI can tie it to your account.
            </Banner>
          )}
          {status === "taken" && (
            <Banner tone="error" title="This installation is connected to another birdsI account">
              Nothing was changed. If it should be yours, remove the birdsI app on GitHub, then install it again from the button below.
            </Banner>
          )}
          {status === "error" && (
            <Banner tone="error" title="birdsI could not finish connecting to GitHub">
              The app may be installed, but birdsI could not read its repositories. Try again in a minute.
            </Banner>
          )}

          {!install ? (
            <p className="t-small c3" style={{ marginTop: 8 }}>
              Connecting through a GitHub App, so birdsI can open pull requests itself, is not switched on for this copy of birdsI yet. The terminal gives you everything else.
            </p>
          ) : active.length > 0 ? (
            active.map((inst) => {
              const shared = repos.filter((r) => r.installation_id === inst.id).length;
              return (
                <div key={inst.id} className="panel grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 min-[901px]:grid-cols-[24px_minmax(0,1fr)_auto]" style={{ marginTop: 16, padding: "18px 20px" }}>
                  <Check {...icon} style={{ color: "var(--ok)", marginTop: 3 }} />
                  <div className="flex flex-col gap-1">
                    <span className="t-body" style={{ fontWeight: 600 }}>
                      GitHub App installed on {inst.account_login || "your account"}
                    </span>
                    <span className="t-small c2">{plural(shared, "repository", "repositories")} shared with birdsI</span>
                  </div>
                  <a className="btn btn-quiet btn-sm col-start-2 justify-self-start min-[901px]:col-start-auto" href={INSTALLATIONS_URL} target="_blank" rel="noreferrer">
                    Change on GitHub
                    <ExternalLink {...icon} />
                  </a>
                </div>
              );
            })
          ) : (
            <div className="panel flex flex-col gap-3.5" style={{ marginTop: 16, padding: "22px 24px" }}>
              <h2 className="t-h2" style={{ fontSize: 23 }}>
                Or connect through GitHub
              </h2>
              <p className="t-small c2">With the GitHub App, birdsI reads the repositories you choose and can open pull requests for its fixes. It takes about a minute.</p>
              <div className="flex justify-end">
                <a className="btn btn-primary btn-sm" href={install}>
                  Install on GitHub
                </a>
              </div>
            </div>
          )}
          {install && active.length > 0 && (
            <p className="t-small c3">
              Not seeing a repository? It has to be shared with the app on GitHub first.{" "}
              <a href={install} style={{ color: "var(--text-2)" }}>
                Add another account
              </a>
            </p>
          )}
        </section>

        <section className="flex flex-col min-[901px]:col-span-6 min-[901px]:col-start-7">
          {repos.length > 0 ? (
            <ConnectForm repos={repos.map((r, i) => ({ id: r.id, fullName: r.full_name, private: r.private, createdAt: r.created_at, scanned: scanned[i] ?? false }))} />
          ) : (
            <div className="flex flex-col gap-3" style={{ paddingTop: 8 }}>
              <h2 className="t-h3">Your repositories</h2>
              <p className="t-body c2" style={{ padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
                None yet. Run npx birdsi in a project folder and it appears here within a minute.
              </p>
              <p className="t-small c3">
                Want a look first?{" "}
                <Link href="/" style={{ color: "var(--text-2)" }}>
                  Try the sample
                </Link>
                .
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
