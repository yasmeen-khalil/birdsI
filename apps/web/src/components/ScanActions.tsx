"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, PlaneTakeoff, RefreshCw, ScanLine, ScanSearch } from "lucide-react";
import type { ScanKind } from "@birdsi/shared";
import { startScanAction } from "@/lib/actions";
import { ButtonArc } from "./Arc";
import { Dropdown } from "./Dropdown";
import { useRefreshVendors } from "./ops/RefreshVendors";
import { Toast } from "./Toast";
import { KIND_DURATION } from "./format";
import { icon, icon14 } from "./icon";

/** Starts a scan of a connected repository and opens its live view. */
export function useStartScan(repoId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pendingKind, setPendingKind] = useState<ScanKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (kind: ScanKind, appDescription?: string, full = false) => {
    setError(null);
    setPendingKind(kind);
    start(async () => {
      const result = await startScanAction({ repoId, kind, ...(appDescription ? { appDescription } : {}), ...(full ? { full: true } : {}) });
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
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run("light")}>
            {pendingKind === "light" && <ButtonArc />}
            {label("light", "Quick check")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run("deep", undefined, true)}>
            {pendingKind === "deep" && <ButtonArc />}
            {label("deep", "Full scan")}
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
            {label("light", "Quick check")}
          </span>
          <small>{KIND_DURATION.light}</small>
        </button>
        <button type="button" className="btn btn-primary btn-sub" disabled={busy} onClick={() => run("deep")} aria-describedby={runningKind ? "scan-running-note" : undefined}>
          <span className="inline-flex items-center gap-2">
            {pendingKind === "deep" ? <ButtonArc /> : <ScanSearch {...icon} />}
            {label("deep", "Full scan")}
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
export function ScanAgainButton({ repoId, kind, label = "Scan again", className = "btn btn-primary btn-sm", full = false, disabled = false }: { repoId: string; kind: ScanKind; label?: string; className?: string; full?: boolean; disabled?: boolean }) {
  const { run, pending, error, clearError } = useStartScan(repoId);
  return (
    <>
      <button type="button" className={className} disabled={pending || disabled} onClick={() => run(kind, undefined, full)}>
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

/**
 * The overview's scan control: one Full scan that runs the whole pipeline in
 * order, and a More menu beside it for the quicker or narrower runs.
 */
export function ScanControls({ repoId, runningKind, syncRunning = false }: { repoId: string; runningKind: ScanKind | null; syncRunning?: boolean }) {
  const { run, pending, pendingKind, error, clearError } = useStartScan(repoId);
  const { refresh: refreshVendors, pending: syncPending, toast: syncToast } = useRefreshVendors(repoId);
  const busy = pending || runningKind !== null;
  const fullLabel = runningKind === "deep" ? "Full scan running" : "Full scan";

  return (
    <>
      <div className="flex items-stretch gap-2.5">
        <Dropdown
          align="right"
          menuLabel="More ways to scan"
          buttonClassName="btn btn-secondary"
          buttonStyle={{ height: "100%", minHeight: 44 }}
          button={
            <>
              More
              <ChevronDown {...icon14} />
            </>
          }
        >
          <button type="button" className="mi" disabled={busy} onClick={() => run("light")} style={busy ? { opacity: 0.45, cursor: "not-allowed" } : undefined}>
            {pendingKind === "light" ? <ButtonArc /> : <ScanLine {...icon} />}
            <span className="flex flex-col">
              <span>{runningKind === "light" ? "Quick check running" : "Quick check"}</span>
              <span className="t-small c3">Packages, exposed keys and known problems. {KIND_DURATION.light}.</span>
            </span>
          </button>
          <button type="button" className="mi" disabled={syncPending || syncRunning} onClick={refreshVendors} style={syncPending || syncRunning ? { opacity: 0.45, cursor: "not-allowed" } : undefined}>
            {syncPending ? <ButtonArc /> : <RefreshCw {...icon} />}
            <span className="flex flex-col">
              <span>{syncRunning ? "Vendors refreshing" : "Refresh vendors"}</span>
              <span className="t-small c3">Plans, usage, limits and spend only.</span>
            </span>
          </button>
          <Link href={`/app/${repoId}/audit`}>
            <PlaneTakeoff {...icon} />
            <span className="flex flex-col">
              <span>Pre-launch audit</span>
              <span className="t-small c3">A launch verdict, area by area. {KIND_DURATION.audit}.</span>
            </span>
          </Link>
        </Dropdown>
        <button type="button" className="btn btn-primary btn-sub" disabled={busy} onClick={() => run("deep", undefined, true)} aria-describedby={runningKind ? "scan-running-note" : undefined}>
          <span className="inline-flex items-center gap-2">
            {pendingKind === "deep" ? <ButtonArc /> : <ScanSearch {...icon} />}
            {fullLabel}
          </span>
          <small>{KIND_DURATION.deep}</small>
        </button>
      </div>
      {error && (
        <Toast tone="error" onClose={clearError}>
          {error}
        </Toast>
      )}
      {syncToast}
    </>
  );
}
