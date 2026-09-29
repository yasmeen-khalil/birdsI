"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAccountAction, disconnectRepoAction, revokeTokenAction, setEmailUpdatesAction } from "@/lib/actions";
import { ButtonArc } from "./Arc";
import { TwoStepButton } from "./TwoStep";

/** The email switch. Optimistic; on failure it flips back and says so. */
export function EmailToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<boolean>(false);
  const [pending, start] = useTransition();
  const save = (next: boolean) =>
    start(async () => {
      setError(false);
      setOn(next);
      const r = await setEmailUpdatesAction(next);
      if (!r.ok) {
        setOn(!next);
        setError(true);
      }
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4" style={{ padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <span className="flex flex-col gap-0.5">
          <span id="email-label" className="t-body">
            Email me when a deep scan or audit finishes
          </span>
          <span className="t-small c3">Sent to the email on your GitHub account</span>
        </span>
        <span className="inline-flex items-center justify-center" style={{ minWidth: 44, minHeight: 44 }}>
          <button type="button" className="switch" role="switch" aria-checked={on} aria-labelledby="email-label" disabled={pending} onClick={() => save(!on)} />
        </span>
      </div>
      {error && (
        <div className="panel flex flex-col gap-2" style={{ padding: "16px 18px" }} role="alert">
          <span className="t-body" style={{ fontWeight: 600 }}>
            Your email setting did not save
          </span>
          <span className="t-small c2">birdsI could not reach its server. The setting is still {on ? "on" : "off"}. Try again in a moment.</span>
          <div className="flex justify-end">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => save(!on)} disabled={pending}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DisconnectRepo({ repoId, name }: { repoId: string; name: string }) {
  const router = useRouter();
  return (
    <TwoStepButton
      label="Disconnect"
      prompt={`Disconnect ${name}?`}
      detail="birdsI stops scanning it and it leaves your list. To stop birdsI reading it on GitHub too, remove it from the app’s repositories there. You can connect it again later."
      confirmLabel="Disconnect"
      cancelLabel="Keep it"
      style={{ alignSelf: "flex-start", marginTop: 6, fontSize: 13, minHeight: 32 }}
      onConfirm={async () => {
        const r = await disconnectRepoAction(repoId);
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      }}
      onDone={() => router.refresh()}
    />
  );
}

export function RevokeToken({ tokenId, name }: { tokenId: string; name: string }) {
  const router = useRouter();
  return (
    <TwoStepButton
      label="Revoke"
      prompt={`Revoke ${name}?`}
      detail="The terminal or coding AI using it is signed out at once. Run birdsi login to sign in again."
      confirmLabel="Revoke"
      cancelLabel="Keep it"
      style={{ alignSelf: "flex-start", marginTop: 6, fontSize: 13, minHeight: 32 }}
      onConfirm={async () => {
        const r = await revokeTokenAction(tokenId);
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      }}
      onDone={() => router.refresh()}
    />
  );
}

/** Delete account in two steps: a summary, then typing the account name. */
export function DeleteAccount({ expected, repoCount }: { expected: string; repoCount: number }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const matches = typed.trim() === expected;

  if (step === 0) {
    return (
      <button type="button" className="btn btn-muted" style={{ alignSelf: "flex-start", minHeight: 44 }} onClick={() => setStep(1)}>
        Delete my account
      </button>
    );
  }
  if (step === 1) {
    return (
      <div className="panel slide-in-down flex flex-col gap-3.5" style={{ padding: "22px 24px", maxWidth: 520 }} role="group" aria-labelledby="del-1">
        <h3 id="del-1" className="t-h2" style={{ fontSize: 23 }}>
          Delete your birdsI account?
        </h3>
        <ul className="t-small c2 flex flex-col gap-1" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{repoCount === 1 ? "1 repository is disconnected" : `${repoCount} repositories are disconnected`}</li>
          <li>Your findings, scans, chats and tokens are deleted</li>
          <li>Pull requests birdsI opened stay on GitHub</li>
        </ul>
        <div className="flex items-center justify-between gap-3" style={{ marginTop: 6 }}>
          <button type="button" className="btn btn-muted" style={{ minHeight: 44 }} onClick={() => setStep(2)}>
            Continue to delete
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStep(0)} autoFocus>
            Keep my account
          </button>
        </div>
      </div>
    );
  }
  const showMismatch = touched && typed.length > 0 && !matches;
  return (
    <form
      className="panel slide-in-down flex flex-col gap-3.5"
      style={{ padding: "22px 24px", maxWidth: 520 }}
      aria-labelledby="del-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!matches) {
          setTouched(true);
          return;
        }
        start(async () => {
          setError(null);
          const r = await deleteAccountAction(typed);
          if (r && !r.ok) setError(r.message);
        });
      }}
    >
      <h3 id="del-2" className="t-h2" style={{ fontSize: 23 }}>
        This cannot be undone
      </h3>
      <div className="field">
        <label htmlFor="confirm-name" className="t-small" style={{ fontWeight: 500 }}>
          Type{" "}
          <span className="t-mono" style={{ fontWeight: 600 }}>
            {expected}
          </span>{" "}
          to confirm
        </label>
        <input id="confirm-name" className={`input mono${showMismatch ? " err" : ""}`} value={typed} onChange={(e) => setTyped(e.target.value)} onBlur={() => setTouched(true)} autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus aria-invalid={showMismatch} aria-describedby={showMismatch ? "confirm-error" : undefined} />
        {showMismatch && (
          <span id="confirm-error" className="t-small" style={{ color: "var(--critical)" }}>
            That does not match your username.
          </span>
        )}
      </div>
      {error && (
        <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <button type="submit" className="btn btn-danger btn-sm" disabled={!matches || pending}>
          {pending && <ButtonArc />}
          Delete account
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStep(0)} disabled={pending}>
          Keep my account
        </button>
      </div>
    </form>
  );
}
