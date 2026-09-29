"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, X } from "lucide-react";
import { icon } from "./icon";

/**
 * Bottom right, 24 from the edges. Success stays 6 seconds or while hovered;
 * errors stay until dismissed.
 */
export function Toast({ tone = "ok", children, action, onClose }: { tone?: "ok" | "error"; children: ReactNode; action?: ReactNode; onClose: () => void }) {
  const [hovered, setHovered] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (tone === "error" || hovered) return;
    const t = window.setTimeout(() => closeRef.current(), 6000);
    return () => window.clearTimeout(t);
  }, [tone, hovered]);
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="sheet slide-in-right"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "fixed", right: 24, bottom: 24, zIndex: 60, width: "min(420px, calc(100vw - 40px))", borderRadius: 12, padding: "12px 12px 12px 16px", display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) auto auto", columnGap: 10, alignItems: "center" }}
    >
      {tone === "ok" ? <Check {...icon} style={{ color: "var(--ok)" }} /> : <CircleAlert {...icon} style={{ color: "var(--critical)" }} />}
      <span className="t-small">{children}</span>
      {action ?? <span />}
      <button type="button" className="btn btn-quiet btn-sm" aria-label="Close" onClick={onClose} style={{ width: 32, padding: 0 }}>
        <X {...icon} />
      </button>
    </div>
  );
}
