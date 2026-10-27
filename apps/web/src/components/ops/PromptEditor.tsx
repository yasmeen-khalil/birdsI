"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PromptSection } from "@birdsi/shared";
import { savePromptAction } from "@/lib/actions";
import { ButtonArc } from "../Arc";
import { LocalTime } from "../LocalTime";
import { Toast } from "../Toast";

/** One section's prompt: birdsI's default, read only, and the owner's addition for this app, edited in place. */
export function PromptEditor({ repoId, section, label, intro, fallback, initial, updatedAt }: { repoId: string; section: PromptSection; label: string; intro: string; fallback: string; initial: string; updatedAt: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const id = `prompt-${section}`;
  const save = () =>
    start(async () => {
      setError(null);
      const r = await savePromptAction(repoId, section, draft.trim());
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setText(draft.trim());
      setSaved(true);
      router.refresh();
    });
  return (
    <form
      className="flex flex-col gap-3"
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-title`} className="t-h3">
          {label}
        </h3>
        <p className="t-small c2">{intro}</p>
      </div>
      <details className="t-small c3">
        <summary style={{ cursor: "pointer" }}>The default, which stays</summary>
        <pre className="t-small c2" style={{ whiteSpace: "pre-wrap", padding: "10px 0" }}>
          {fallback}
        </pre>
      </details>
      <label htmlFor={id} className="t-small c2">
        Your addition for this app
      </label>
      <textarea id={id} className="input" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} disabled={pending} style={{ minHeight: 96 }} placeholder="Nothing added yet." />
      {error && (
        <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="t-small c3">{updatedAt && text ? <>Saved <LocalTime iso={updatedAt} style="relative" />, used by the next map.</> : text ? "Saved, used by the next map." : "Used by the next map once saved."}</span>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || draft.trim() === text.trim()}>
          {pending && <ButtonArc />}
          Save
        </button>
      </div>
      {saved && <Toast onClose={() => setSaved(false)}>Saved. The next map of this app uses it.</Toast>}
    </form>
  );
}
