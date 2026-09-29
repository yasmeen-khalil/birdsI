"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ScanLine, ScanSearch } from "lucide-react";
import type { ScanKind } from "@birdsi/shared";
import { startScanAction } from "@/lib/actions";
import { ButtonArc } from "./Arc";
import { Toast } from "./Toast";
import { KIND_DURATION } from "./format";
import { icon } from "./icon";

/** Starts a scan of a connected repository and opens its live view. */
export function useStartScan(repoId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pendingKind, setPendingKind] = useState<ScanKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (kind: ScanKind, appDescription?: string) => {
    setError(null);
    setPendingKind(kind);
    start(async () => {
      const result = await startScanAction({ repoId, kind, ...(appDescription ? { appDescription } : {}) });
      if (result.ok) router.push(kind === "audit" ? `/app/${repoId}/audit` : `/app/${repoId}/scans/${result.data.scanId}`);
      else {
        setError(result.message);
        setPendingKind(null);
      }
    });
  };
  return { run, pending, pendingKind, error, clearError: () => setError(null) };
}

/** Light and Deep scan buttons with their durations. Disabled while a scan runs. */
export function ScanButtons({ repoId, runningKind, layout = "sub" }: { repoId: string; runningKind: ScanKind | null; layout?: "sub" | "compact" | "mobile" }) {
  const { run, pending, pendingKind, error, clearError } = useStartScan(repoId);
  const busy = pending || runningKind !== null;
  const label = (kind: ScanKind, text: string) => (runningKind === kind ? `${text} running` : text);

  if (layout === "compact") {
    return (
      <>
        <div className="flex flex-wrap justify-end gap-2.5">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run("deep")}>
            {pendingKind === "deep" && <ButtonArc />}
            {label("deep", "Deep scan")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run("light")}>
            {pendingKind === "light" && <ButtonArc />}
            {label("light", "Light scan")}
          </button>
        </div>
        {error && (
          <Toast tone="error" onClose={clearError}>
            {error}
          </Toast>
        )}
      </>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 min-[901px]:flex min-[901px]:gap-3" style={{ alignItems: "stretch" }}>
        <button type="button" className="btn btn-secondary btn-sub" disabled={busy} onClick={() => run("light")} aria-describedby={runningKind ? "scan-running-note" : undefined}>
          <span className="inline-flex items-center gap-2">
            {pendingKind === "light" ? <ButtonArc /> : <ScanLine {...icon} />}
            {label("light", "Light scan")}
          </span>
          <small>{KIND_DURATION.light}</small>
        </button>
        <button type="button" className="btn btn-primary btn-sub" disabled={busy} onClick={() => run("deep")} aria-describedby={runningKind ? "scan-running-note" : undefined}>
          <span className="inline-flex items-center gap-2">
            {pendingKind === "deep" ? <ButtonArc /> : <ScanSearch {...icon} />}
            {label("deep", "Deep scan")}
          </span>
          <small>{KIND_DURATION.deep}</small>
        </button>
      </div>
      {error && (
        <Toast tone="error" onClose={clearError}>
          {error}
        </Toast>
      )}
    </>
  );
}

/** One button that starts a given kind again, used by stopped and failed states. */
export function ScanAgainButton({ repoId, kind, label = "Scan again", className = "btn btn-primary btn-sm" }: { repoId: string; kind: ScanKind; label?: string; className?: string }) {
  const { run, pending, error, clearError } = useStartScan(repoId);
  return (
    <>
      <button type="button" className={className} disabled={pending} onClick={() => run(kind)}>
        {pending && <ButtonArc />}
        {label}
      </button>
      {error && (
        <Toast tone="error" onClose={clearError}>
          {error}
        </Toast>
      )}
    </>
  );
}
