import type { CSSProperties } from "react";

export function Skeleton({ width = "100%", height = 12, round = false, style, className }: { width?: number | string; height?: number; round?: boolean; style?: CSSProperties; className?: string }) {
  return <div className={`sk${className ? ` ${className}` : ""}`} aria-hidden="true" style={{ width, height, ...(round ? { borderRadius: "50%" } : {}), ...style }} />;
}

/** A labelled loading region: the words are read out, the bars are decoration. */
export function LoadingRegion({ label, children, className, style }: { label: string; children: React.ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div role="status" aria-live="polite" className={className} style={style}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
