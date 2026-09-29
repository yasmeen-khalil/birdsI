"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ScanLine } from "lucide-react";
import { ButtonArc } from "./Arc";
import { icon } from "./icon";

/** Starts (or reuses) a scan of the sample repository and opens it. No sign-in needed. */
export function DemoButton({ label = "Scan a sample repo", className = "btn btn-primary btn-lg", showIcon = true }: { label?: string; className?: string; showIcon?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const res = await fetch("/api/demo", { method: "POST" });
              const body = (await res.json().catch(() => null)) as { scanId?: string; reused?: boolean; error?: { message?: string } } | null;
              if (!res.ok || !body?.scanId) {
                setError(body?.error?.message ?? "The sample scan could not start. Try again in a moment.");
                return;
              }
              router.push(`/demo/${body.scanId}${body.reused ? "?reused=1" : ""}`);
            } catch {
              setError("birdsI could not be reached. Check your connection and try again.");
            }
          })
        }
      >
        {pending ? <ButtonArc /> : showIcon ? <ScanLine {...icon} /> : null}
        {pending ? "Starting the sample scan" : label}
      </button>
      {error && (
        <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
