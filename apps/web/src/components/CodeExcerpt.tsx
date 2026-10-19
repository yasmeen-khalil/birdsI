import type { ReactNode } from "react";

/** Numbered lines with the lines that matter highlighted. Text only, never HTML. */
export function CodeExcerpt({
  code,
  startLine = 1,
  highlightFrom,
  highlightTo,
  path,
  note,
  compact = false,
}: {
  code: string;
  startLine?: number;
  highlightFrom?: number;
  highlightTo?: number;
  path?: string | null;
  note?: ReactNode;
  compact?: boolean;
}) {
  const lines = code.replace(/\n+$/, "").split("\n");
  const from = highlightFrom ?? null;
  const to = highlightTo ?? highlightFrom ?? null;
  return (
    <div className="code" style={compact ? { fontSize: 12.5 } : undefined}>
      {(path || note) && (
        <div className="hd">
          {path ? (
            <span className="t-mono-s min-w-0 truncate" style={{ color: "var(--text)" }}>
              {path}
            </span>
          ) : (
            <span />
          )}
          {note && <span className="text-right max-[900px]:hidden">{note}</span>}
        </div>
      )}
      <div className="bd">
        {lines.map((line, i) => {
          const n = startLine + i;
          const hl = from !== null && to !== null && n >= from && n <= to;
          return (
            <div key={i} className={`ln${hl ? " hl" : ""} max-[900px]:grid-cols-[34px_minmax(0,1fr)]! max-[900px]:[&>span:first-child]:pr-3!`}>
              <span>{n}</span>
              <span>{line.length === 0 ? " " : line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
