"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Dependency, Severity } from "@birdsi/shared";
import { LocalTime } from "./LocalTime";
import { SEVERITY_LABEL, safeUrl } from "./format";
import { icon } from "./icon";

type Filter = "all" | "problems" | "docs";

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function parts(v: string | null): [number, number, number] | null {
  if (!v) return null;
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** "major", "5 majors", "minor", "up to date". */
export function versionGap(inUse: string, latest: string | null): string | null {
  const a = parts(inUse);
  const b = parts(latest);
  if (!a || !b) return null;
  if (b[0] > a[0]) return b[0] - a[0] === 1 ? "major" : `${b[0] - a[0]} majors`;
  if (b[0] === a[0] && b[1] > a[1]) return "minor";
  if (b[0] === a[0] && b[1] === a[1] && b[2] > a[2]) return "patch";
  return "up to date";
}

function worstVuln(d: Dependency) {
  return [...d.vulnerabilities].sort((x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity])[0] ?? null;
}

function docsBehind(d: Dependency): boolean {
  return d.docsCheck?.status === "behind" || d.docsCheck?.status === "deprecated";
}

/** Known problems first, then packages behind their docs, then the biggest version gaps. */
export function rankDependencies(deps: Dependency[]): Dependency[] {
  const score = (d: Dependency) => {
    const v = worstVuln(d);
    if (v) return SEV_RANK[v.severity];
    if (docsBehind(d)) return 10;
    const a = parts(d.versionInUse);
    const b = parts(d.latestVersion);
    const majors = a && b ? Math.max(0, b[0] - a[0]) : 0;
    return 20 - Math.min(majors, 5) + (d.direct ? 0 : 10);
  };
  return [...deps].sort((x, y) => score(x) - score(y) || x.name.localeCompare(y.name));
}

function registryUrl(d: Dependency): string {
  const name = encodeURIComponent(d.name).replace(/%40/g, "@").replace(/%2F/g, "/");
  switch (d.ecosystem) {
    case "npm":
      return `https://www.npmjs.com/package/${name}`;
    case "PyPI":
      return `https://pypi.org/project/${name}/`;
    case "crates.io":
      return `https://crates.io/crates/${name}`;
    case "RubyGems":
      return `https://rubygems.org/gems/${name}`;
    case "Go":
      return `https://pkg.go.dev/${name}`;
    case "Packagist":
      return `https://packagist.org/packages/${name}`;
    case "NuGet":
      return `https://www.nuget.org/packages/${name}`;
    case "Hex":
      return `https://hex.pm/packages/${name}`;
    case "Pub":
      return `https://pub.dev/packages/${name}`;
    default:
      return `https://osv.dev/list?q=${encodeURIComponent(d.name)}`;
  }
}

function linkFor(d: Dependency): { href: string; label: string } {
  const v = worstVuln(d);
  const vulnUrl = safeUrl(v?.url);
  if (vulnUrl) return { href: vulnUrl, label: `Advisory for ${d.name}` };
  const docUrl = safeUrl(d.docsCheck?.doc?.url);
  if (docUrl) return { href: docUrl, label: `Docs for ${d.name}` };
  return { href: registryUrl(d), label: `${d.name} on its package registry` };
}

function Problems({ d }: { d: Dependency }) {
  const v = worstVuln(d);
  if (!v) return <span className="t-small c3">None known</span>;
  const tone = v.severity === "critical" ? "bad" : v.severity === "high" ? "warn" : "";
  const more = d.vulnerabilities.length - 1;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`tag ${tone}`} title={v.summary} style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
        {SEVERITY_LABEL[v.severity]}: {v.summary}
      </span>
      {more > 0 && <span className="t-small c3">and {more} more</span>}
    </span>
  );
}

function Docs({ d }: { d: Dependency }) {
  const c = d.docsCheck;
  if (!c) return <span className="t-small c3">Checked in full scans</span>;
  if (c.status === "current")
    return (
      <span className="t-small c2">
        Current, read <LocalTime iso={c.checkedAt} style="relative" />
      </span>
    );
  if (c.status === "behind") return <span className="tag" title={c.note}>{c.note ?? "Behind the docs"}</span>;
  if (c.status === "deprecated") return <span className="tag warn" title={c.note}>{c.note ?? "Deprecated in the docs"}</span>;
  return <span className="t-small c3">Could not check</span>;
}

export function DependencyTable({ dependencies, limit, showAllHref, filterable = true }: { dependencies: Dependency[]; limit?: number; showAllHref?: string; filterable?: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const ranked = rankDependencies(dependencies);
  const problems = ranked.filter((d) => d.vulnerabilities.length > 0);
  const behind = ranked.filter(docsBehind);
  const filtered = filter === "problems" ? problems : filter === "docs" ? behind : ranked;
  const shown = limit ? filtered.slice(0, limit) : filtered;

  const chip = (value: Filter, label: string, count: number) => (
    <button type="button" className={`chip${filter === value ? " on" : ""}`} aria-pressed={filter === value} onClick={() => setFilter(value)} style={{ minHeight: 32 }}>
      {label} <b>{count}</b>
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      {filterable && dependencies.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter packages">
          {chip("all", "All", ranked.length)}
          {chip("problems", "Known problems", problems.length)}
          {chip("docs", "Behind the docs", behind.length)}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="t-body c2" style={{ padding: "16px 0", borderTop: "1px solid var(--line)" }}>
          {filter === "problems" ? "No package has a known problem." : filter === "docs" ? "No package is behind its current docs." : "No packages were found."}
        </p>
      ) : (
        <>
          <table className="tbl max-[900px]:hidden">
            <thead>
              <tr>
                <th style={{ width: "26%" }}>Package</th>
                <th style={{ width: "12%" }}>In use</th>
                <th style={{ width: "16%" }}>Latest</th>
                <th style={{ width: "22%" }}>Known problems</th>
                <th>Docs check</th>
                <th style={{ width: 24 }}>
                  <span className="sr-only">Link</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const gap = versionGap(d.versionInUse, d.latestVersion);
                const link = linkFor(d);
                return (
                  <tr key={`${d.ecosystem}:${d.manifestPath}:${d.name}`}>
                    <td>
                      <span style={{ fontWeight: 600, wordBreak: "break-word" }}>{d.name}</span>
                      {!d.direct && <span className="t-small c3"> (indirect)</span>}
                    </td>
                    <td className="t-mono">{d.versionInUse}</td>
                    <td>
                      {d.latestVersion ? <span className="t-mono">{d.latestVersion}</span> : <span className="t-small c3">Unknown</span>} {gap && <span className="t-small c3">{gap}</span>}
                    </td>
                    <td>
                      <Problems d={d} />
                    </td>
                    <td>
                      <Docs d={d} />
                    </td>
                    <td>
                      <a href={link.href} target="_blank" rel="noreferrer" aria-label={link.label} className="c3 inline-flex">
                        <ExternalLink {...icon} />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-col min-[901px]:hidden">
            {shown.map((d, i) => {
              const v = worstVuln(d);
              return (
                <a
                  key={`${d.ecosystem}:${d.manifestPath}:${d.name}`}
                  href={linkFor(d).href}
                  target="_blank"
                  rel="noreferrer"
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-y-1"
                  style={{ padding: "13px 0", borderTop: "1px solid var(--line)", ...(i === shown.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}), textDecoration: "none", color: "var(--text)", minHeight: 44 }}
                >
                  <span className="min-w-0 truncate" style={{ fontWeight: 600 }}>
                    {d.name}
                  </span>
                  {v ? (
                    <span className={`tag ${v.severity === "critical" ? "bad" : "warn"}`}>Known problem</span>
                  ) : docsBehind(d) ? (
                    <span className="tag">Behind the docs</span>
                  ) : d.docsCheck?.status === "current" ? (
                    <span className="t-small c2">Current</span>
                  ) : (
                    <span />
                  )}
                  <span className="t-mono-s c2 col-span-2">
                    {d.versionInUse}
                    {d.latestVersion && d.latestVersion !== d.versionInUse ? `, latest ${d.latestVersion}` : ""}
                  </span>
                </a>
              );
            })}
          </div>
        </>
      )}
      {limit && showAllHref && filtered.length > shown.length && (
        <div className="flex items-center justify-between gap-4">
          <span className="t-small c3">Showing the {shown.length} that matter most.</span>
          <Link className="btn btn-quiet btn-sm" href={showAllHref}>
            Show all {filtered.length}
          </Link>
        </div>
      )}
    </div>
  );
}
