/** The working indicator: an accent arc on a ring. It turns only while something runs. */
export function Arc({ size = 16, spinning = true, idle = false, className }: { size?: number; spinning?: boolean; idle?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" style={{ width: size, height: size, flex: "none" }} className={`${spinning && !idle ? "arc-spin" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
      {!idle && <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

/** Arc sized for inside a button; follows the button's text color. */
export function ButtonArc() {
  return (
    <svg viewBox="0 0 16 16" style={{ width: 14, height: 14, flex: "none" }} className="arc-spin" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
