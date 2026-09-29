"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { Dropdown } from "../Dropdown";
import { repoName, repoOwner } from "../format";
import { icon, icon14 } from "../icon";

export interface RepoOption {
  id: string;
  fullName: string;
  defaultBranch: string;
}

/** Switches between connected repositories. Opens below, on the left, beside its control. */
export function RepoSwitcher({ repos, current, compact = false }: { repos: RepoOption[]; current: RepoOption | null; compact?: boolean }) {
  const button = current ? (
    compact ? (
      <>
        <span className="truncate">{repoName(current.fullName)}</span>
        <ChevronDown {...icon14} className="i c3" />
      </>
    ) : (
      <>
        <span className="c3">{repoOwner(current.fullName)} /</span>
        <span className="truncate">{repoName(current.fullName)}</span>
        <span className="c3">{current.defaultBranch}</span>
        <ChevronDown {...icon14} className="i c3" />
      </>
    )
  ) : (
    <>
      <span>Choose a repository</span>
      <ChevronDown {...icon14} className="i c3" />
    </>
  );
  return (
    <Dropdown button={button} buttonLabel={current ? `Repository: ${current.fullName}. Switch repository` : "Choose a repository"} menuLabel="Your repositories" buttonStyle={{ maxWidth: compact ? 180 : 360, minHeight: compact ? 36 : undefined }}>
      {repos.map((r) => (
        <Link key={r.id} href={`/app/${r.id}`} aria-current={current?.id === r.id ? "true" : undefined}>
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{repoName(r.fullName)}</span>
            <span className="t-small c3 truncate">{r.fullName}</span>
          </span>
        </Link>
      ))}
      {repos.length > 0 && <hr className="rule" style={{ margin: "6px 0" }} />}
      <Link href="/connect">
        <Plus {...icon} />
        Add a repository
      </Link>
    </Dropdown>
  );
}
