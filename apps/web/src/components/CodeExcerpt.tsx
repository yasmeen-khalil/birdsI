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

interface DiffFile {
  path: string;
  deleted: boolean;
  added: number;
  removed: number;
  lines: Array<{ kind: "add" | "del" | "ctx"; n: number | null; text: string }>;
}

/** Splits a unified diff into files with numbered lines. */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldN = 0;
  let newN = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("diff --git")) {
      current = null;
      continue;
    }
    if (raw.startsWith("--- ")) {
      current = { path: raw.slice(4).replace(/^a\//, ""), deleted: false, added: 0, removed: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (raw.startsWith("+++ ")) {
      if (!current) {
        current = { path: "", deleted: false, added: 0, removed: 0, lines: [] };
        files.push(current);
      }
      const target = raw.slice(4);
      if (target === "/dev/null") current.deleted = true;
      else current.path = target.replace(/^b\//, "");
      continue;
    }
    if (!current) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldN = Number(hunk[1]);
      newN = Number(hunk[2]);
      continue;
    }
    if (raw.startsWith("+")) {
      current.lines.push({ kind: "add", n: newN++, text: raw.slice(1) });
      current.added += 1;
    } else if (raw.startsWith("-")) {
      current.lines.push({ kind: "del", n: oldN++, text: raw.slice(1) });
      current.removed += 1;
    } else if (raw.startsWith(" ")) {
      current.lines.push({ kind: "ctx", n: newN++, text: raw.slice(1) });
      oldN += 1;
    }
  }
  return files.filter((f) => f.path !== "");
}

export function DiffView({ patch }: { patch: string }) {
  const files = parseUnifiedDiff(patch);
  if (files.length === 0) {
    return (
      <div className="code">
        <div className="bd" style={{ padding: "10px 14px", whiteSpace: "pre", color: "var(--text-2)" }}>
          {patch}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {files.map((file) => (
        <div className="code" key={file.path}>
          <div className="hd">
            <span className="inline-flex min-w-0 items-center gap-2.5">
              <span className="t-mono-s truncate" style={{ color: "var(--text)" }}>
                {file.path}
              </span>
              {file.deleted && <span className="tag bad">Deleted</span>}
            </span>
            <span>{file.deleted ? `${file.removed} lines removed` : [file.removed ? `${file.removed} removed` : "", file.added ? `${file.added} added` : ""].filter(Boolean).join(", ")}</span>
          </div>
          {!file.deleted && (
            <div className="bd">
              {file.lines.map((l, i) => (
                <div key={i} className={`ln${l.kind === "add" ? " add" : l.kind === "del" ? " del" : ""}`}>
                  <span>{l.n}</span>
                  <span>
                    {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
                    {l.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
