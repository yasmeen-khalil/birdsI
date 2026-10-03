"use client";

import { useState, type ReactNode } from "react";
import { PlaneTakeoff } from "lucide-react";
import { ButtonArc } from "./Arc";
import { useStartScan } from "./ScanActions";
import { Toast } from "./Toast";
import { icon } from "./icon";

/**
 * The audit entry: what it covers and the optional app description on the
 * left, the checklist and the start button on the right.
 */
export function AuditStartForm({ repoId, disabled, intro, checklist }: { repoId: string; disabled: boolean; intro: ReactNode; checklist: ReactNode }) {
  const [about, setAbout] = useState("");
  const { run, pending, error, clearError } = useStartScan(repoId);
  return (
    <form
      className="grid grid-cols-1 gap-y-10 min-[901px]:grid-cols-12 min-[901px]:gap-x-6"
      onSubmit={(e) => {
        e.preventDefault();
        run("audit", about.trim() || undefined);
      }}
    >
      <section className="flex flex-col gap-[22px] min-[901px]:col-span-6">
        {intro}
        <div className="field" style={{ maxWidth: 560, marginTop: 14 }}>
          <label htmlFor="audit-about">
            What does your app do?{" "}
            <span className="c3" style={{ fontWeight: 400 }}>
              Optional
            </span>
          </label>
          <textarea id="audit-about" className="input" rows={3} maxLength={2000} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Class bookings for a yoga studio. Customers sign in, book a class and pay with Stripe." style={{ resize: "vertical" }} aria-describedby="audit-about-hint" />
          <span id="audit-about-hint" className="t-small c3">
            A sentence or two helps birdsI judge what matters most for your launch.
          </span>
        </div>
      </section>
      <section className="flex flex-col gap-8 min-[901px]:col-span-5 min-[901px]:col-start-8">
        {checklist}
        <div className="flex justify-end min-[901px]:mt-auto">
          <button type="submit" className="btn btn-primary btn-lg max-[900px]:w-full" disabled={pending || disabled}>
            {pending ? <ButtonArc /> : <PlaneTakeoff {...icon} />}
            Start pre-launch audit
          </button>
        </div>
      </section>
      {error && (
        <Toast tone="error" onClose={clearError}>
          {error}
        </Toast>
      )}
    </form>
  );
}

export function PrintButton() {
  return (
    <button type="button" className="btn btn-secondary no-print" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}
