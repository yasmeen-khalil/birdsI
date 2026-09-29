"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { icon14 } from "./icon";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="btn btn-quiet btn-sm"
      style={{ height: 28 }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
        window.setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "copied" ? <Check {...icon14} /> : <Copy {...icon14} />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}</span>
    </button>
  );
}
