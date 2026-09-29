"use client";

import { useState, useTransition, type ReactNode } from "react";
import { ButtonArc } from "./Arc";

/**
 * A destructive or dismissive action in two steps: a muted control at rest,
 * then a confirm row with the action on the left (red only here) and the
 * way back on the right.
 */
export function TwoStepButton({
  label,
  prompt,
  detail,
  confirmLabel,
  cancelLabel = "Keep it",
  danger = true,
  onConfirm,
  onDone,
  className,
  style,
}: {
  label: string;
  prompt: ReactNode;
  detail?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<{ ok: true } | { ok: false; message: string }>;
  onDone?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!armed) {
    return (
      <button type="button" className={`btn btn-muted ${className ?? ""}`} style={style} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="panel slide-in-down flex w-full flex-col gap-3" style={{ padding: "16px 18px", maxWidth: 520 }} role="group" aria-label={label}>
      <p className="t-body" style={{ fontWeight: 600 }}>
        {prompt}
      </p>
      {detail && <div className="t-small c2">{detail}</div>}
      {error && (
        <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className={`btn btn-sm ${danger ? "btn-danger" : "btn-secondary"}`}
          disabled={pending}
          autoFocus
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await onConfirm();
              if (!result.ok) setError(result.message);
              else {
                setArmed(false);
                onDone?.();
              }
            })
          }
        >
          {pending && <ButtonArc />}
          {confirmLabel}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => setArmed(false)}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
