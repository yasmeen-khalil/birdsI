import type { CSSProperties } from "react";
import type { Severity } from "@birdsi/shared";
import { folderLabel } from "./format";

export interface MapFolder {
  name: string;
  files: string[];
  /** Total files in the folder when `files` was capped. */
  count?: number;
}

/**
 * The repository seen from above: one square per file, grouped by top folder.
 * rest: every file at rest. scan: files light up as they are read, the file
 * being read glows in the accent, files with findings are ringed.
 */
export function BirdsEyeMap({
  folders,
  hits = {},
  mode = "rest",
  lit,
  current = null,
  size = "big",
  findingsHref,
  label,
  className,
  style,
}: {
  folders: MapFolder[];
  hits?: Record<string, Severity>;
  mode?: "rest" | "scan";
  lit?: string[];
  current?: string | null;
  size?: "big" | "default" | "small";
  /** When set, ringed squares link to the findings for that file. */
  findingsHref?: string;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  const litSet = new Set(lit ?? []);
  const sizeClass = size === "big" ? "big max-[900px]:[--s:6px]! max-[900px]:[--g:3px]!" : size === "small" ? "small" : "max-[900px]:[--s:6px]! max-[900px]:[--g:3px]!";
  return (
    <div className={`map max-[900px]:gap-x-[18px]! max-[900px]:gap-y-4! ${className ?? ""}`} style={style} role="group" aria-label={label}>
      {folders.map((folder) => {
        const count = folder.count ?? folder.files.length;
        const cols = Math.min(16, Math.max(4, Math.ceil(Math.sqrt(folder.files.length) * 1.75)));
        return (
          <div className="fold" key={folder.name}>
            <div className="nm">
              <b>{folderLabel(folder.name)}</b> {count}
            </div>
            <div className={`cells ${sizeClass}`} style={{ "--cols": cols } as CSSProperties}>
              {folder.files.map((path) => {
                const hit = hits[path];
                let cls = mode === "rest" ? "q on" : litSet.has(path) ? "q lit" : "q";
                if (hit) cls = hit === "critical" ? "q hit" : hit === "high" ? "q hith" : "q hitm";
                else if (current === path) cls = "q cur";
                if (hit && findingsHref) {
                  return <a key={path} className={cls} href={`${findingsHref}?file=${encodeURIComponent(path)}`} aria-label={`${path} has findings`} title={path} />;
                }
                return <i key={path} className={cls} title={hit || current === path ? path : undefined} aria-hidden="true" />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The map legend shown beside a live scan. */
export function MapLegend() {
  const item = (cls: string, text: string) => (
    <span className="inline-flex items-center gap-[7px]">
      <i className={cls} style={{ width: 9, display: "inline-block" }} aria-hidden="true" />
      {text}
    </span>
  );
  return (
    <div className="t-small c3 flex flex-wrap items-center gap-x-[18px] gap-y-2">
      {item("q", "Waiting")}
      {item("q lit", "Checked")}
      {item("q cur", "Reading now")}
      {item("q hit", "Finding")}
    </div>
  );
}

/** Findings grouped to the worst severity per file, for ringing squares. */
export function hitsFromFindings(findings: Array<{ severity: Severity; location: { path: string } | null; status?: string }>): Record<string, Severity> {
  const order: Severity[] = ["critical", "high", "medium", "low"];
  const hits: Record<string, Severity> = {};
  for (const f of findings) {
    if (!f.location || f.status === "dismissed") continue;
    const prev = hits[f.location.path];
    if (!prev || order.indexOf(f.severity) < order.indexOf(prev)) hits[f.location.path] = f.severity;
  }
  return hits;
}
