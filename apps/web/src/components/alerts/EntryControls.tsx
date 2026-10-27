"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { ENTRY_KIND_LABEL, ENTRY_PERIOD_LABEL, entryAmountWords, type AppEntry, type EntryKind, type EntryPeriod } from "@birdsi/shared";
import { addEntryAction, removeEntryAction } from "@/lib/actions";
import { TwoStepButton } from "../TwoStep";
import { icon } from "../icon";

function dateWords(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const KINDS: EntryKind[] = ["subscription", "fee", "credit", "note"];
const PERIODS: EntryPeriod[] = ["month", "year", "once"];

/** What no API reports, entered by the owner: listed, removable, and a form to add one. Quiet by design. */
export function EntryControls({ repoId, entries, vendors }: { repoId: string; entries: AppEntry[]; vendors: Array<{ slug: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EntryKind>("subscription");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<EntryPeriod>("month");
  const [renewsOn, setRenewsOn] = useState("");
  const [vendor, setVendor] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const vendorName = (slug: string | null) => (slug ? (vendors.find((v) => v.slug === slug)?.name ?? slug) : null);
  const needsAmount = kind === "subscription" || kind === "fee";
  const amountNumber = amount.trim() === "" ? null : Number(amount);
  const ready = label.trim().length >= 2 && (!needsAmount || (amountNumber !== null && Number.isFinite(amountNumber)));

  return (
    <div className="flex flex-col gap-4">
      {entries.length === 0 ? (
        <p className="t-small c3">Nothing entered yet. Add a subscription paid elsewhere, a yearly fee, a credit that runs out, or a note. Each one says it came from you.</p>
      ) : (
        <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
          {entries.map((e) => (
            <div key={e.id} className="flex flex-wrap items-start justify-between gap-3" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="t-body" style={{ fontWeight: 600 }}>
                  {e.label}
                  <span className="tag" style={{ marginLeft: 8 }}>
                    {ENTRY_KIND_LABEL[e.kind]}
                  </span>
                  {e.vendor && (
                    <span className="t-small c3" style={{ fontWeight: 400, marginLeft: 8 }}>
                      {vendorName(e.vendor)}
                    </span>
                  )}
                </span>
                <span className="t-small c2">
                  {entryAmountWords(e) ?? "No amount"}
                  {e.renewsOn ? `, renews ${dateWords(e.renewsOn)}` : ""}
                  {e.note ? `. ${e.note}` : ""}
                </span>
              </span>
              <TwoStepButton
                label="Remove"
                prompt={`Remove ${e.label}?`}
                confirmLabel="Remove"
                restClassName="btn btn-quiet btn-sm"
                onConfirm={async () => {
                  const r = await removeEntryAction(repoId, e.id);
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
            Add an entry
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          style={{ maxWidth: 620 }}
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await addEntryAction(repoId, { kind, label, amountUsd: needsAmount || amountNumber !== null ? amountNumber : null, period: amountNumber !== null ? period : null, renewsOn: renewsOn || null, vendor: vendor || null, note: note.trim() || null });
              if (!r.ok) {
                setError(r.message);
                return;
              }
              setLabel("");
              setAmount("");
              setRenewsOn("");
              setVendor("");
              setNote("");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="flex flex-wrap gap-3">
            <div className="field" style={{ minWidth: 160 }}>
              <label htmlFor="entry-kind">What it is</label>
              <select id="entry-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as EntryKind)} disabled={pending}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ENTRY_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 240, flex: 1 }}>
              <label htmlFor="entry-label">Name</label>
              <input id="entry-label" className="input" value={label} maxLength={120} placeholder="Apple Developer Program" onChange={(e) => setLabel(e.target.value)} disabled={pending} required />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="field" style={{ minWidth: 140 }}>
              <label htmlFor="entry-amount">Amount in dollars{needsAmount ? "" : ", optional"}</label>
              <input id="entry-amount" className="input" type="number" min={0} step="0.01" value={amount} placeholder="99" onChange={(e) => setAmount(e.target.value)} disabled={pending} required={needsAmount} />
            </div>
            <div className="field" style={{ minWidth: 140 }}>
              <label htmlFor="entry-period">How often</label>
              <select id="entry-period" className="input" value={period} onChange={(e) => setPeriod(e.target.value as EntryPeriod)} disabled={pending}>
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {ENTRY_PERIOD_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label htmlFor="entry-renews">Renews or ends on, optional</label>
              <input id="entry-renews" className="input" type="date" value={renewsOn} onChange={(e) => setRenewsOn(e.target.value)} disabled={pending} />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="field" style={{ minWidth: 180 }}>
              <label htmlFor="entry-vendor">Vendor, optional</label>
              <select id="entry-vendor" className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={pending}>
                <option value="">None</option>
                {vendors.map((v) => (
                  <option key={v.slug} value={v.slug}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 240, flex: 1 }}>
              <label htmlFor="entry-note">What it means, optional</label>
              <input id="entry-note" className="input" value={note} maxLength={300} placeholder="Needed to keep the iOS app on the store" onChange={(e) => setNote(e.target.value)} disabled={pending} />
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
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !ready}>
              {pending ? "Adding" : "Add the entry"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
