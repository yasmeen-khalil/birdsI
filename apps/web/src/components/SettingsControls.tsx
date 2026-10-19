"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, ExternalLink, Plus } from "lucide-react";
import { connectVendorAction, deleteAccountAction, disconnectRepoAction, disconnectVendorAction, revokeTokenAction, setEmailUpdatesAction } from "@/lib/actions";
import { ButtonArc } from "./Arc";
import { Dropdown } from "./Dropdown";
import { Toast } from "./Toast";
import { TwoStepButton } from "./TwoStep";
import { safeUrl } from "./format";
import { icon, icon14 } from "./icon";

/** The email switch. Optimistic; on failure it flips back and says so. */
export function EmailToggle({ initial, keySet, address }: { initial: boolean; keySet: boolean; address: string | null }) {
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
            Email me the alerts
          </span>
          <span className="t-small c3">
            {!keySet
              ? "Not sent yet: RESEND_API_KEY is not set on birdsI. Your choice is kept for when it is."
              : !address
                ? "Not sent: your account has no email address. Sign in again with a GitHub account that has one."
                : `Each new critical or warning alert, one email per read, to ${address}. Every alert says whether it was emailed.`}
          </span>
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
      detail="birdsI stops mapping it and deletes its maps, findings, vendors and record. To stop birdsI reading it on GitHub too, remove it from the app’s repositories there. You can connect it again later, starting from a new map."
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
      detail="The terminal or coding agent using it is signed out at once. Run birdsi login to sign in again."
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
          <li>Your apps, maps, findings, vendor details, keys and tokens are deleted</li>
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

export interface ConnectorOption {
  slug: string;
  name: string;
  tokenHint: string;
  tokenUrl: string;
  fields: Array<{ key: string; label: string; hint: string; required: boolean }>;
}

export function DisconnectAccount({ connectionId, name }: { connectionId: string; name: string }) {
  const router = useRouter();
  return (
    <TwoStepButton
      label="Disconnect"
      prompt={`Disconnect ${name}?`}
      detail="birdsI deletes the token and stops reading the account. What it already read stays until the next vendor refresh."
      confirmLabel="Disconnect"
      cancelLabel="Keep it"
      style={{ alignSelf: "flex-start", marginTop: 6, fontSize: 13, minHeight: 32 }}
      onConfirm={async () => {
        const r = await disconnectVendorAction(connectionId);
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      }}
      onDone={() => router.refresh()}
    />
  );
}

/** Pick a service, paste a read-only token, connect. The token is checked before it is stored. */
export function ConnectAccount({ catalog, connected }: { catalog: ConnectorOption[]; connected: string[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<ConnectorOption | null>(null);
  const [token, setToken] = useState("");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const available = catalog.filter((c) => !connected.includes(c.slug));

  const reset = () => {
    setPicked(null);
    setToken("");
    setSettings({});
    setError(null);
  };

  if (available.length === 0 && !picked) {
    return (
      <>
        <p className="t-small c3">Every service birdsI can read is connected.</p>
        {done && <Toast onClose={() => setDone(false)}>Connected. birdsI is reading the account now.</Toast>}
      </>
    );
  }

  if (!picked) {
    return (
      <>
        <Dropdown
          buttonClassName="btn btn-secondary btn-sm"
          menuLabel="Services birdsI can read"
          button={
            <>
              <Plus {...icon} />
              Connect an account
              <ChevronDown {...icon14} />
            </>
          }
        >
          {available.map((c) => (
            <button key={c.slug} type="button" className="mi" onClick={() => setPicked(c)}>
              {c.name}
            </button>
          ))}
        </Dropdown>
        {done && <Toast onClose={() => setDone(false)}>Connected. birdsI is reading the account now.</Toast>}
      </>
    );
  }

  const url = safeUrl(picked.tokenUrl);
  const missing = token.trim().length === 0 || picked.fields.some((f) => f.required && !(settings[f.key] ?? "").trim());
  return (
    <form
      className="panel slide-in-down flex flex-col gap-4"
      style={{ padding: "22px 24px", maxWidth: 560 }}
      aria-labelledby="connect-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (missing) return;
        start(async () => {
          setError(null);
          const r = await connectVendorAction({ vendorSlug: picked.slug, token, settings });
          if (!r.ok) {
            setError(r.message);
            return;
          }
          reset();
          setDone(true);
          router.refresh();
        });
      }}
    >
      <h3 id="connect-title" className="t-h3">
        Connect {picked.name}
      </h3>
      <p className="t-small c2">
        {picked.tokenHint}
        {url && (
          <>
            {" "}
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ color: "var(--text)" }}>
              Create a token
              <ExternalLink {...icon14} />
            </a>
          </>
        )}
      </p>
      <div className="field">
        <label htmlFor="connect-token">Token</label>
        <input id="connect-token" type="password" className="input mono" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} autoFocus disabled={pending} />
      </div>
      {picked.fields.map((f) => (
        <div key={f.key} className="field">
          <label htmlFor={`connect-${f.key}`}>
            {f.label}
            {!f.required && <span className="c3" style={{ fontWeight: 400 }}> (optional)</span>}
          </label>
          <input id={`connect-${f.key}`} className="input mono" value={settings[f.key] ?? ""} onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))} autoComplete="off" spellCheck={false} disabled={pending} aria-describedby={`connect-${f.key}-hint`} />
          <span id={`connect-${f.key}-hint`} className="t-small c3">
            {f.hint}
          </span>
        </div>
      ))}
      {error && (
        <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={reset}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || missing}>
          {pending && <ButtonArc />}
          {pending ? "Checking the token" : "Connect"}
        </button>
      </div>
    </form>
  );
}
