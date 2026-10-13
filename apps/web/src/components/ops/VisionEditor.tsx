"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { saveVisionAction } from "@/lib/actions";
import { ButtonArc } from "../Arc";
import { LocalTime } from "../LocalTime";
import { Toast } from "../Toast";
import { icon14 } from "../icon";

/** The owner's statement of what the app is for, edited in place. */
export function VisionEditor({ repoId, initial, updatedAt }: { repoId: string; initial: string; updatedAt: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const empty = text.trim() === "";

  const open = () => {
    setDraft(text);
    setEditing(true);
  };
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveVisionAction(repoId, draft.trim());
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setText(draft.trim());
      setEditing(false);
      setSaved(true);
      router.refresh();
    });

  return (
    <section className="flex flex-col gap-4" aria-labelledby="vision-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="vision-title" className="t-h2 max-[900px]:text-[24px]!">
          Vision
        </h2>
        {!editing && !empty && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={open}>
            <Pencil {...icon14} />
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor="vision-text" className="t-small c2">
            What is this app for, who uses it, and where is it going? Your own words are best.
          </label>
          <textarea id="vision-text" className="input" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={20000} autoFocus disabled={pending} style={{ minHeight: 150 }} />
          {error && (
            <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2.5">
            <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending || draft.trim() === text.trim()}>
              {pending && <ButtonArc />}
              Save
            </button>
          </div>
        </form>
      ) : empty ? (
        <div className="panel flex flex-col gap-3" style={{ padding: "22px 24px", maxWidth: 640 }}>
          <p className="t-body">No vision written yet.</p>
          <p className="t-small c2">The vision is what you are building and why. Your coding agent reads it, and chat answers with it in mind.</p>
          <div className="flex justify-end">
            <button type="button" className="btn btn-primary btn-sm" onClick={open}>
              Write the vision
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2" style={{ maxWidth: 760 }}>
          <p className="t-body-l" style={{ whiteSpace: "pre-wrap" }}>
            {text}
          </p>
          {updatedAt && (
            <p className="t-small c3">
              Last updated <LocalTime iso={updatedAt} />
            </p>
          )}
        </div>
      )}
      {saved && <Toast onClose={() => setSaved(false)}>Vision saved. Your coding agent and chat can read it now.</Toast>}
    </section>
  );
}
