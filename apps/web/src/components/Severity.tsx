import type { Severity } from "@birdsi/shared";
import { SEVERITY_CLASS, SEVERITY_LABEL } from "./format";

/** Four-step signal meter plus the word, so severity never rests on color alone. */
export function SeverityMeter({ severity, label, className }: { severity: Severity; label?: string | number | null; className?: string }) {
  const text = label === undefined ? SEVERITY_LABEL[severity] : label;
  return (
    <span className={`sev ${SEVERITY_CLASS[severity]}${className ? ` ${className}` : ""}`}>
      <span className="m" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      {text === null ? <span className="sr-only">{SEVERITY_LABEL[severity]}</span> : text}
    </span>
  );
}
