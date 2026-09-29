"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A button that opens a menu below it, on the side of the control. Closes
 * on outside click, Escape, or choosing an item.
 */
export function Dropdown({
  button,
  buttonClassName = "repo",
  buttonLabel,
  align = "left",
  children,
  menuLabel,
  buttonStyle,
}: {
  button: ReactNode;
  buttonClassName?: string;
  buttonLabel?: string;
  align?: "left" | "right";
  children: ReactNode;
  menuLabel: string;
  buttonStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative inline-flex min-w-0">
      <button
        type="button"
        className={buttonClassName}
        style={buttonStyle}
        aria-expanded={open}
        aria-controls={id}
        aria-label={buttonLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open && (
        <div
          id={id}
          className="menu slide-in-down"
          style={{ top: "calc(100% + 6px)", ...(align === "left" ? { left: 0 } : { right: 0 }) }}
          aria-label={menuLabel}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a,button")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
