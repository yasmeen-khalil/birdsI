"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import type { AppDeadline } from "@birdsi/shared";
import { addDeadlineAction, removeDeadlineAction } from "@/lib/actions";
import { TwoStepButton } from "../TwoStep";
import { icon } from "../icon";

function dateWords(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Dates the owner wants to be warned about: listed, removable, and a form to add one. */
export function DeadlineControls({ repoId, deadlines, vendors }: { repoId: string; deadlines: AppDeadline[]; vendors: Array<{ slug: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [vendor, setVendor] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const vendorName = (slug: string | null) => (slug ? (vendors.find((v) => v.slug === slug)?.name ?? slug) : null);

  return (
    <div className="flex flex-col gap-4">
      {deadlines.length === 0 ? (
        <p className="t-small c3">No dates yet. Add a trial that ends, a credit that runs out, a renewal: the alerts warn from 30 days before.</p>
      ) : (
        <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
          {deadlines.map((d) => (
            <div key={d.id} className="flex flex-wrap items-start justify-between gap-3" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="t-body" style={{ fontWeight: 600 }}>
                  {d.label}
                  {d.vendor && <span className="t-small c3" style={{ fontWeight: 400, marginLeft: 8 }}>{vendorName(d.vendor)}</span>}
                </span>
                <span className="t-small c2">
                  {dateWords(d.dueOn)}
                  {d.note ? `. ${d.note}` : ""}
                </span>
              </span>
              <TwoStepButton
                label="Remove"
                prompt={`Stop watching ${d.label}?`}
                confirmLabel="Remove"
                restClassName="btn btn-quiet btn-sm"
                onConfirm={async () => {
                  const r = await removeDeadlineAction(repoId, d.id);
                  return r.ok ? { ok: true } : { ok: false, message: r.message };
                }}
                onDone={() => router.refresh()}
              />
            </div>
          ))}
        </div>
      )}

      {!open ? (
        <div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
            <Plus {...icon} />
            Add a date
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          style={{ maxWidth: 560 }}
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await addDeadlineAction(repoId, { label, dueOn, vendor: vendor || null, note: note.trim() || null });
              if (!r.ok) {
                setError(r.message);
                return;
              }
              setLabel("");
              setDueOn("");
              setVendor("");
              setNote("");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="flex flex-wrap gap-3">
            <div className="field" style={{ minWidth: 240, flex: 1 }}>
              <label htmlFor="deadline-label">What happens</label>
              <input id="deadline-label" className="input" value={label} maxLength={120} placeholder="The OneSignal trial ends" onChange={(e) => setLabel(e.target.value)} disabled={pending} required />
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label htmlFor="deadline-date">On</label>
              <input id="deadline-date" className="input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} disabled={pending} required />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="field" style={{ minWidth: 180 }}>
              <label htmlFor="deadline-vendor">Vendor</label>
              <select id="deadline-vendor" className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={pending}>
                <option value="">None</option>
                {vendors.map((v) => (
                  <option key={v.slug} value={v.slug}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 240, flex: 1 }}>
              <label htmlFor="deadline-note">What it means, optional</label>
              <input id="deadline-note" className="input" value={note} maxLength={300} placeholder="After it the plan is Free" onChange={(e) => setNote(e.target.value)} disabled={pending} />
            </div>
          </div>
          {error && (
            <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending || label.trim().length < 2 || !dueOn}>
              {pending ? "Adding" : "Add the date"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
