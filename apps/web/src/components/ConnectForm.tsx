"use client";

import Link from "next/link";
import { useState } from "react";
import { ScanLine, ScanSearch } from "lucide-react";
import type { ScanKind } from "@birdsi/shared";
import { ButtonArc } from "./Arc";
import { LocalTime } from "./LocalTime";
import { useStartScan } from "./ScanActions";
import { Toast } from "./Toast";
import { repoName } from "./format";
import { icon } from "./icon";

export interface ConnectRepo {
  id: string;
  fullName: string;
  private: boolean;
  createdAt: string;
  scanned: boolean;
}

/** Pick a connected repository and the first scan, then start it. */
export function ConnectForm({ repos }: { repos: ConnectRepo[] }) {
  const firstUnscanned = repos.find((r) => !r.scanned) ?? repos[0];
  const [repoId, setRepoId] = useState(firstUnscanned?.id ?? "");
  const [kind, setKind] = useState<Extract<ScanKind, "light" | "deep">>("light");
  const selected = repos.find((r) => r.id === repoId) ?? null;
  const { run, pending, error, clearError } = useStartScan(repoId);

  const option = (checked: boolean) => ({
    padding: "16px 18px",
    borderRadius: "var(--r-md)",
    border: `1px solid ${checked ? "var(--text-2)" : "transparent"}`,
    borderBottomColor: checked ? "var(--text-2)" : "var(--line)",
    background: checked ? "var(--raised)" : "transparent",
    cursor: "pointer",
    minHeight: 44,
  });

  return (
    <form
      className="flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (selected) run(kind);
      }}
    >
      <fieldset className="flex flex-col" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="t-h3" style={{ padding: "0 0 12px" }}>
          Your shared repositories
        </legend>
        {repos.map((r) => (
          <label key={r.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center" style={option(r.id === repoId)}>
            <input type="radio" name="repo" value={r.id} checked={r.id === repoId} onChange={() => setRepoId(r.id)} style={{ accentColor: "var(--accent)", width: 16, height: 16, margin: 0 }} />
            <span className="flex min-w-0 flex-col gap-[3px]">
              <span className="t-body truncate" style={{ fontWeight: 600 }}>
                {repoName(r.fullName)}
              </span>
              <span className="t-small c2">
                {r.private ? "Private" : "Public"}, connected <LocalTime iso={r.createdAt} style="relative" />
              </span>
            </span>
            <span className="t-small c3">{r.scanned ? "Scanned" : ""}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3" style={{ border: 0, margin: "32px 0 0", padding: 0 }}>
        <legend className="t-h3" style={{ padding: "0 0 12px" }}>
          First scan
        </legend>
        <div className="grid grid-cols-1 gap-3 min-[901px]:grid-cols-2">
          {(
            [
              ["light", "Light scan", "About 1 minute. Dependencies, secrets, known problems."],
              ["deep", "Deep scan", "About 6 minutes. Also reads every file and checks it against the docs."],
            ] as const
          ).map(([value, title, body]) => (
            <label key={value} className="grid grid-cols-[28px_minmax(0,1fr)]" style={{ padding: "14px 16px", border: `1px solid ${kind === value ? "var(--text-2)" : "var(--line-strong)"}`, borderRadius: "var(--r-md)", background: kind === value ? "var(--raised)" : "transparent", cursor: "pointer" }}>
              <input type="radio" name="scan" value={value} checked={kind === value} onChange={() => setKind(value)} style={{ accentColor: "var(--accent)", width: 16, height: 16, margin: "3px 0 0" }} />
              <span className="flex flex-col gap-[3px]">
                <span className="t-body" style={{ fontWeight: 600 }}>
                  {title}
                </span>
                <span className="t-small c2">{body}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse items-stretch gap-3 min-[901px]:flex-row min-[901px]:items-center min-[901px]:justify-between" style={{ marginTop: 40 }}>
        {selected ? (
          <Link className="btn btn-muted self-center min-[901px]:self-auto" href={`/app/${selected.id}`} style={{ minHeight: 44 }}>
            Skip for now
          </Link>
        ) : (
          <span />
        )}
        <button type="submit" className="btn btn-primary btn-lg" disabled={!selected || pending}>
          {pending ? <ButtonArc /> : kind === "light" ? <ScanLine {...icon} /> : <ScanSearch {...icon} />}
          {selected ? `Start ${kind} scan of ${repoName(selected.fullName)}` : "Choose a repository"}
        </button>
      </div>
      {error && (
        <Toast tone="error" onClose={clearError}>
          {error}
        </Toast>
      )}
    </form>
  );
}
