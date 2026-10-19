"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw, ScanLine } from "lucide-react";
import { startScanAction } from "@/lib/actions";
import { ButtonArc } from "./Arc";
import { useRefreshVendors } from "./ops/RefreshVendors";
import { Toast } from "./Toast";
import { icon } from "./icon";

/** Starts a map of the app's code and opens its live view. */
export function useStartScan(repoId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setError(null);
    start(async () => {
      const result = await startScanAction({ repoId });
      if (result.ok) router.push(`/app/${repoId}/scans/${result.data.scanId}`);
      else setError(result.message);
    });
  };
  return { run, pending, error, clearError: () => setError(null) };
}

/** One button that maps the code again, used by stopped and failed states and empty pages. */
export function ScanAgainButton({ repoId, label = "Map again", className = "btn btn-primary btn-sm", disabled = false }: { repoId: string; label?: string; className?: string; disabled?: boolean }) {
  const { run, pending, error, clearError } = useStartScan(repoId);
  return (
    <>
      <button type="button" className={className} disabled={pending || disabled} onClick={run}>
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
 * The page's two refreshes, the likely one on the right: read the accounts
 * now (the worker also does it every hour), and map the code again.
 */
export function ScanControls({ repoId, mapRunning, readRunning = false }: { repoId: string; mapRunning: boolean; readRunning?: boolean }) {
  const { run, pending, error, clearError } = useStartScan(repoId);
  const { refresh, pending: readPending, toast } = useRefreshVendors(repoId);
  return (
    <>
      <div className="flex flex-wrap items-stretch justify-end gap-2.5">
        <button type="button" className="btn btn-secondary" disabled={readPending || readRunning} onClick={refresh}>
          {readPending ? <ButtonArc /> : <RefreshCw {...icon} />}
          {readRunning ? "Reading accounts" : "Read accounts"}
        </button>
        <button type="button" className="btn btn-primary" disabled={pending || mapRunning} onClick={run}>
          {pending ? <ButtonArc /> : <ScanLine {...icon} />}
          {mapRunning ? "Mapping" : "Map the code"}
        </button>
      </div>
      {error && (
        <Toast tone="error" onClose={clearError}>
          {error}
        </Toast>
      )}
      {toast}
    </>
  );
}
