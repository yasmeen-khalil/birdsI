"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore, useTransition, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ScanKind, Step } from "@birdsi/shared";
import { dismissFindingAction, reopenFindingAction } from "@/lib/actions";
import { ButtonArc } from "./Arc";
import { CopyButton } from "./CopyButton";
import { useStartScan } from "./ScanActions";
import { Toast } from "./Toast";
import { TwoStepButton } from "./TwoStep";
import { icon } from "./icon";

/** Dismiss with a two-step confirm, or Reopen once dismissed. Muted, on the left. */
export function DismissControl({ findingId, repoId, dismissed }: { findingId: string; repoId: string; dismissed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (dismissed) {
    return (
      <>
        <button
          type="button"
          className="btn btn-muted"
          style={{ minHeight: 44 }}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await reopenFindingAction(findingId, repoId);
              if (r.ok) router.refresh();
              else setError(r.message);
            })
          }
        >
          {pending ? "Reopening" : "Reopen"}
        </button>
        {error && (
          <Toast tone="error" onClose={() => setError(null)}>
            {error}
          </Toast>
        )}
      </>
    );
  }
  return (
    <TwoStepButton
      label="Dismiss"
      prompt="Dismiss this finding?"
      detail="It leaves your list and later scans keep it dismissed. You can reopen it from Findings with Show dismissed."
      confirmLabel="Dismiss"
      cancelLabel="Keep it"
      danger={false}
      style={{ minHeight: 44 }}
      onConfirm={async () => {
        const r = await dismissFindingAction(findingId, repoId);
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      }}
      onDone={() => router.refresh()}
    />
  );
}

/** "Check again": runs the same kind of scan so the check that found this runs again. */
export function CheckAgainButton({ repoId, kind }: { repoId: string; kind: ScanKind }) {
  const { run, pending, error, clearError } = useStartScan(repoId);
  return (
    <>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(kind)}>
        {pending ? <ButtonArc /> : <RefreshCw {...icon} />}
        Check again
      </button>
      {error && (
        <Toast tone="error" onClose={clearError}>
          {error}
        </Toast>
      )}
    </>
  );
}

// Step progress, kept on this browser per finding so the list and the side panel agree.
const listeners = new Set<() => void>();
const storageKey = (findingId: string) => `birdsi:steps:${findingId}`;

function readDone(findingId: string): string {
  try {
    return window.localStorage.getItem(storageKey(findingId)) ?? "";
  } catch {
    return "";
  }
}

function writeDone(findingId: string, done: number[]) {
  try {
    window.localStorage.setItem(storageKey(findingId), done.join(","));
  } catch {
    // Private windows may refuse storage; the ticks still work for this visit.
    memory.set(findingId, done.join(","));
  }
  listeners.forEach((l) => l());
}

const memory = new Map<string, string>();

function useDoneSteps(findingId: string): [number[], (i: number, on: boolean) => void] {
  const raw = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => memory.get(findingId) ?? readDone(findingId),
    () => "",
  );
  const done = raw
    .split(",")
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n));
  const set = (i: number, on: boolean) => {
    const next = new Set(done);
    if (on) next.add(i);
    else next.delete(i);
    writeDone(findingId, [...next].sort((a, b) => a - b));
  };
  return [done, set];
}

/** The numbered steps with a tick box each and copyable snippets. */
export function StepsChecklist({ findingId, steps }: { findingId: string; steps: Step[] }) {
  const [done, setDone] = useDoneSteps(findingId);
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--line)" }}>
      {steps.map((step, i) => {
        const id = `step-${findingId}-${i}`;
        return (
          <li key={i} className="grid grid-cols-[36px_minmax(0,1fr)_32px] gap-x-2 min-[901px]:grid-cols-[44px_minmax(0,1fr)_28px]" style={{ padding: "20px 0", borderBottom: "1px solid var(--line)" }}>
            <span aria-hidden="true" style={{ fontFamily: "var(--serif)", fontSize: 24, lineHeight: 1.1, color: "var(--text-3)" }}>
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-3.5">
              <label htmlFor={id} className="t-body-l" style={{ cursor: "pointer" }}>
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </label>
              {step.detail && <span className="t-body c2">{step.detail}</span>}
              {step.snippet && (
                <span className="code" style={{ display: "block" }}>
                  <span className="hd">
                    <span>{step.snippetLanguage ? step.snippetLanguage.toUpperCase() : "Snippet"}</span>
                    <CopyButton text={step.snippet} />
                  </span>
                  <span className="bd" style={{ display: "block", padding: "12px 18px", whiteSpace: "pre", color: "var(--text)" }}>
                    {step.snippet}
                  </span>
                </span>
              )}
            </span>
            <span className="flex justify-center" style={{ paddingTop: 2 }}>
              <input id={id} type="checkbox" checked={done.includes(i)} onChange={(e) => setDone(i, e.target.checked)} aria-label={`Mark step ${i + 1} done`} style={{ accentColor: "var(--accent)", width: 20, height: 20, margin: "4px 0 0" }} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function StepsProgress({ findingId, total }: { findingId: string; total: number }) {
  const [done] = useDoneSteps(findingId);
  const count = done.filter((i) => i < total).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="t-small flex justify-between gap-3">
        <span className="c2" aria-live="polite">
          {count} of {total} steps done
        </span>
        <span className="c3">Saved on this browser</span>
      </div>
      <div className="bar ink" role="progressbar" aria-label="Steps done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count}>
        <i style={{ width: `${total ? Math.round((count / total) * 100) : 0}%` }} />
      </div>
    </div>
  );
}
