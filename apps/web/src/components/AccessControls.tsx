"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Send, X } from "lucide-react";
import { decideAccessAction, requestAccessAction, withdrawRequestAction } from "@/lib/actions";
import { TwoStepButton } from "./TwoStep";
import { icon } from "./icon";

/** The one thing a new account can do: ask for access. */
export function RequestAccess() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="btn btn-primary btn-lg"
        style={{ alignSelf: "flex-start" }}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await requestAccessAction();
            if (r.ok) router.refresh();
            else setError(r.message);
          })
        }
      >
        <Send {...icon} />
        Request access
      </button>
      {error && (
        <span className="t-small c2" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Deletes an account that is not approved, in two steps. */
export function WithdrawRequest() {
  return (
    <TwoStepButton
      label="Delete my account"
      prompt="Delete your account?"
      detail="Your request and your sign-in details are removed from birdsI."
      confirmLabel="Delete"
      cancelLabel="Keep it"
      style={{ fontSize: 13, minHeight: 36 }}
      onConfirm={async () => {
        const r = await withdrawRequestAction();
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      }}
    />
  );
}

/** The owner's decision on one account. */
export function DecideAccess({ userId, access }: { userId: string; access: "pending" | "approved" | "denied" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (decision: "approved" | "denied") =>
    start(async () => {
      setError(null);
      const r = await decideAccessAction(userId, decision);
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  return (
    <span className="flex flex-col items-end gap-1.5">
      <span className="flex flex-wrap justify-end gap-2">
        {access !== "denied" && (
          <button type="button" className="btn btn-muted btn-sm" disabled={pending} onClick={() => decide("denied")}>
            <X {...icon} />
            {access === "approved" ? "Remove access" : "Deny"}
          </button>
        )}
        {access !== "approved" && (
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => decide("approved")}>
            <Check {...icon} />
            Approve
          </button>
        )}
      </span>
      {error && (
        <span className="t-small c2" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
