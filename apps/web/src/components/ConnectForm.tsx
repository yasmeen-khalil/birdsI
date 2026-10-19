"use client";

import Link from "next/link";
import { useState } from "react";
import { ScanLine } from "lucide-react";
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

/** Pick a connected repository and map it. */
export function ConnectForm({ repos }: { repos: ConnectRepo[] }) {
  const firstUnscanned = repos.find((r) => !r.scanned) ?? repos[0];
  const [repoId, setRepoId] = useState(firstUnscanned?.id ?? "");
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
        if (selected) run();
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
            <span className="t-small c3">{r.scanned ? "Mapped" : ""}</span>
          </label>
        ))}
      </fieldset>

      <p className="t-small c2" style={{ marginTop: 24 }}>
        The map reads every file, package and outside service, the deployments, crons, webhooks, store apps and migrations, in about a minute. No model reads the code.
      </p>

      <div className="flex flex-col-reverse items-stretch gap-3 min-[901px]:flex-row min-[901px]:items-center min-[901px]:justify-between" style={{ marginTop: 40 }}>
        {selected ? (
          <Link className="btn btn-muted self-center min-[901px]:self-auto" href={`/app/${selected.id}`} style={{ minHeight: 44 }}>
            Skip for now
          </Link>
        ) : (
          <span />
        )}
        <button type="submit" className="btn btn-primary btn-lg" disabled={!selected || pending}>
          {pending ? <ButtonArc /> : <ScanLine {...icon} />}
          {selected ? `Map ${repoName(selected.fullName)}` : "Choose a repository"}
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
