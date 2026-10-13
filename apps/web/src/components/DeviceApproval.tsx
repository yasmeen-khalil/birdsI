"use client";

import { useState, useTransition } from "react";
import { Check, CircleAlert } from "lucide-react";
import { approveDeviceAction, denyDeviceAction } from "@/lib/actions";
import { ButtonArc } from "./Arc";
import { icon } from "./icon";

export type DeviceState = "form" | "approved" | "denied" | "expired" | "already_used" | "not_found";

const RESULT: Record<Exclude<DeviceState, "form">, { title: string; body: string; ok: boolean }> = {
  approved: { title: "Your terminal is signed in", body: "Go back to your terminal. It continues on its own within a few seconds. You can close this tab.", ok: true },
  denied: { title: "Sign-in denied", body: "Nothing was shared with the terminal. If you did not start this, you can ignore it.", ok: true },
  expired: { title: "This code has expired", body: "Codes last ten minutes. Run npx birdsi login again for a new one.", ok: false },
  already_used: { title: "This code was already used", body: "It was approved or denied before. Run npx birdsi login again if your terminal is still waiting.", ok: false },
  not_found: { title: "birdsI does not know this code", body: "Check it against the code shown in your terminal, including the dash.", ok: false },
};

/** Approve or deny a terminal sign-in. Deny is muted on the left, Approve on the right. */
export function DeviceApproval({ initialCode, initialState }: { initialCode: string; initialState: DeviceState }) {
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<DeviceState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [acting, setActing] = useState<"approve" | "deny" | null>(null);
  const valid = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(code.trim());

  if (state !== "form") {
    const r = RESULT[state];
    return (
      <div className="flex flex-col gap-4" role="status">
        <div className="flex items-center gap-2.5">
          {r.ok ? <Check {...icon} style={{ color: "var(--ok)" }} /> : <CircleAlert {...icon} style={{ color: "var(--critical)" }} />}
          <h2 className="t-h2">{r.title}</h2>
        </div>
        <p className="t-body c2">{r.body}</p>
        {!r.ok && (
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setState("form")}>
              Use another code
            </button>
          </div>
        )}
      </div>
    );
  }

  const normalized = () => {
    const raw = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : code.trim().toUpperCase();
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        setActing("approve");
        start(async () => {
          setError(null);
          const r = await approveDeviceAction(normalized());
          if (r.ok) setState(r.data.status);
          else setError(r.message);
          setActing(null);
        });
      }}
    >
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="device-code">Code from your terminal</label>
        <input id="device-code" className="input mono" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX" style={{ fontSize: 20, letterSpacing: "0.08em", height: 52 }} aria-describedby="device-hint" />
        <span id="device-hint" className="t-small c3">
          It must match the code your terminal shows.
        </span>
      </div>
      {error && (
        <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3" style={{ maxWidth: 520 }}>
        <button
          type="button"
          className="btn btn-muted"
          style={{ minHeight: 44 }}
          disabled={pending || !valid}
          onClick={() => {
            setActing("deny");
            start(async () => {
              setError(null);
              const r = await denyDeviceAction(normalized());
              if (r.ok) setState("denied");
              else setError(r.message);
              setActing(null);
            });
          }}
        >
          {acting === "deny" ? "Denying" : "Deny"}
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending || !valid}>
          {acting === "approve" && <ButtonArc />}
          Approve
        </button>
      </div>
    </form>
  );
}
