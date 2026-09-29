import Link from "next/link";
import { Wordmark } from "../Wordmark";
import { initials } from "../format";
import { AskButton } from "./ChatDock";
import { MobileMenu } from "./MobileMenu";
import { NavLinks } from "./NavLinks";
import { RepoSwitcher, type RepoOption } from "./RepoSwitcher";

/** The app's top bar: wordmark, repository, sections, Ask birdsI, and the account. */
export function TopBar({ login, repos, current, settingsActive = false }: { login: string | null; repos: RepoOption[]; current: RepoOption | null; settingsActive?: boolean }) {
  const navRepo = current ?? repos[0] ?? null;
  return (
    <header className="topbar">
      <div className="contents max-[900px]:hidden">
        <Wordmark href={navRepo ? `/app/${navRepo.id}` : "/app"} />
        {repos.length > 0 && <RepoSwitcher repos={repos} current={current} />}
        {navRepo && <NavLinks repoId={navRepo.id} />}
        <span className="inline-flex items-center gap-3.5" style={{ marginLeft: "auto" }}>
          {current && <AskButton repoId={current.id} />}
          <Link className="avatar" href="/settings" aria-label="Settings" style={{ textDecoration: "none", ...(settingsActive ? { borderColor: "var(--text-2)", color: "var(--text)" } : {}) }}>
            {initials(login)}
          </Link>
        </span>
      </div>
      <div className="flex w-full items-center gap-3 min-[901px]:hidden" style={{ marginRight: -8 }}>
        <Wordmark href={navRepo ? `/app/${navRepo.id}` : "/app"} markOnly />
        {repos.length > 0 && <RepoSwitcher repos={repos} current={current} compact />}
        <span className="inline-flex gap-0.5" style={{ marginLeft: "auto" }}>
          {current && <AskButton repoId={current.id} iconOnly />}
          <MobileMenu repoId={navRepo?.id ?? null} />
        </span>
      </div>
    </header>
  );
}
