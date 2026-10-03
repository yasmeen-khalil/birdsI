import {
  CONFIDENCE_ORDER,
  SEVERITY_ORDER,
  type AuditReport,
  type Confidence,
  type Finding,
  type Fix,
  type Repo,
  type Scan,
  type ScanKind,
  type ScanStep,
  type Severity,
} from "@birdsi/shared";

/** How output may look: colour, Unicode glyphs, and the width to wrap prose at. */
export interface Style {
  color: boolean;
  unicode: boolean;
  /** Columns to wrap long prose at; undefined means do not wrap. */
  width: number | undefined;
}

export const PLAIN: Style = { color: false, unicode: true, width: undefined };

/** True when the terminal can be trusted to draw the Unicode glyphs. */
export function supportsUnicode(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") {
    return Boolean(
      env.WT_SESSION ||
        env.TERMINUS_SUBLIME ||
        env.ConEmuTask === "{cmd::Cmder}" ||
        env.TERM_PROGRAM === "vscode" ||
        env.TERM === "xterm-256color" ||
        env.TERM === "alacritty",
    );
  }
  if (env.TERM === "linux" || env.TERM === "dumb") return false;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  if (locale === "") return true;
  return /utf-?8/i.test(locale);
}

/** Colour only on a terminal, and never when NO_COLOR is set (https://no-color.org). */
export function supportsColor(stream: NodeJS.WriteStream, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.TERM === "dumb") return false;
  return Boolean(stream.isTTY);
}

export function styleFor(stream: NodeJS.WriteStream, options: { ascii?: boolean } = {}, env: NodeJS.ProcessEnv = process.env): Style {
  const columns = stream.isTTY ? stream.columns : undefined;
  return {
    color: supportsColor(stream, env),
    unicode: options.ascii ? false : supportsUnicode(env),
    width: columns ? Math.min(columns, 100) : undefined,
  };
}

// ANSI

function sgr(style: Style, open: string, text: string): string {
  return style.color && text !== "" ? `\x1b[${open}m${text}\x1b[0m` : text;
}
export const paint = {
  bold: (s: Style, t: string) => sgr(s, "1", t),
  dim: (s: Style, t: string) => sgr(s, "2", t),
  critical: (s: Style, t: string) => sgr(s, "1;91", t),
  high: (s: Style, t: string) => sgr(s, "1;33", t),
  ok: (s: Style, t: string) => sgr(s, "32", t),
  accent: (s: Style, t: string) => sgr(s, "1;35", t),
  fail: (s: Style, t: string) => sgr(s, "1;91", t),
};

/** Removes ANSI escapes, for measuring what the terminal will show. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

// Glyphs

export function glyphs(style: Style) {
  return style.unicode
    ? { done: "✓", failed: "✗", running: "◐", pending: "○", bullet: "-" }
    : { done: "+", failed: "x", running: ">", pending: "-", bullet: "-" };
}

export function confidenceGlyph(confidence: Confidence, style: Style): string {
  if (style.unicode) return confidence === "proven" ? "●" : confidence === "doc_verified" ? "◉" : "◌";
  return confidence === "proven" ? "[P]" : confidence === "doc_verified" ? "[D]" : "[J]";
}

export const CONFIDENCE_WORD: Record<Confidence, string> = {
  proven: "Proven",
  doc_verified: "Doc-verified",
  judgment: "Judgment",
};

export const CONFIDENCE_MEANING: Record<Confidence, string> = {
  proven: "A tool or rule proved this. You can trust it outright.",
  doc_verified: "Checked against a current official document, cited below.",
  judgment: "birdsI's reading of the code, with no tool or document behind it. Worth checking yourself.",
};

export function severityWord(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export function paintSeverity(severity: Severity, style: Style, text: string = severityWord(severity)): string {
  if (severity === "critical") return paint.critical(style, text);
  if (severity === "high") return paint.high(style, text);
  return paint.bold(style, text);
}

export const KIND_WORD: Record<ScanKind, string> = {
  light: "Light scan",
  deep: "Deep scan",
  audit: "Pre-launch audit",
};

/** Default step labels, used until the server names a step. */
export const STEP_LABEL: Record<ScanStep, string> = {
  fetch: "Receive your files",
  inventory: "Read the repository",
  dependencies: "Map dependencies",
  vendors: "Find the services it runs on",
  secrets: "Look for committed secrets",
  vulnerabilities: "Check known problems",
  docs: "Check against current docs",
  review: "Read the code",
  crosscheck: "Cross-check the code",
  audit: "Pre-launch audit",
  rank: "Verify and sort",
};

/** What a step counts, for "212 files", "43 packages". */
export const STEP_UNIT: Record<ScanStep, string> = {
  fetch: "files",
  inventory: "files",
  dependencies: "packages",
  vendors: "services",
  secrets: "files",
  vulnerabilities: "packages",
  docs: "libraries",
  review: "files",
  crosscheck: "findings",
  audit: "areas",
  rank: "findings",
};

// Durations

/** 3s, 41s, 2m 48s, 1h 5m. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** 1:12, 12:05, 1:02:03 for elapsed clocks. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Text layout

/** Word-wraps text to the style's width, prefixing every line with indent. */
export function wrap(text: string, style: Style, indent: string): string {
  const lines = text.split(/\r?\n/);
  if (!style.width) return lines.map((l) => indent + l).join("\n");
  const max = Math.max(20, style.width - indent.length);
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= max) {
      out.push(indent + line);
      continue;
    }
    let current = "";
    for (const word of line.split(/(\s+)/)) {
      if ((current + word).length > max && current.trim() !== "") {
        out.push(indent + current.trimEnd());
        current = word.trimStart();
      } else {
        current += word;
      }
    }
    if (current.trim() !== "") out.push(indent + current.trimEnd());
  }
  return out.join("\n");
}

// Findings

export type FindingLike = Pick<
  Finding,
  "title" | "severity" | "confidence" | "location" | "actionKind" | "evidence"
> & { status?: Finding["status"] };

export function locationText(finding: Pick<Finding, "location">): string | null {
  const loc = finding.location;
  if (!loc) return null;
  if (loc.lineStart === undefined) return loc.path;
  return `${loc.path}:${loc.lineStart}`;
}

/**
 * One line per finding: severity, confidence glyph, title, path:line.
 * With a number, it is the numbered row used under a severity heading.
 */
export function findingRow(
  finding: FindingLike,
  style: Style,
  options: { number?: number; numberWidth?: number; severity?: boolean } = {},
): string {
  const parts: string[] = ["  "];
  if (options.number !== undefined) {
    parts.push(paint.dim(style, String(options.number).padStart(options.numberWidth ?? 1)), "  ");
  }
  if (options.severity ?? options.number === undefined) {
    const word = finding.severity.padEnd(8);
    parts.push(finding.severity === "critical" || finding.severity === "high" ? paintSeverity(finding.severity, style, word) : word, " ");
  }
  parts.push(confidenceGlyph(finding.confidence, style), " ", finding.title);
  const where = locationText(finding);
  if (where) parts.push("  ", paint.dim(style, where));
  const status = statusNote(finding.status);
  if (status) parts.push("  ", paint.dim(style, `(${status})`));
  return parts.join("");
}

function statusNote(status: Finding["status"] | undefined): string | null {
  if (status === "dismissed") return "dismissed";
  if (status === "fixed") return "fixed";
  if (status === "pr_open") return "pull request open";
  return null;
}

/** The evidence line: "Proven. Secret rule x." / "Doc-verified. docs.stripe.com/webhooks." */
export function evidenceLine(finding: FindingLike): string {
  const word = CONFIDENCE_WORD[finding.confidence];
  const ev = finding.evidence;
  if (finding.confidence === "doc_verified" && ev.doc) return `${word}. ${ev.doc.title}, ${shortUrl(ev.doc.url)}.`;
  if (finding.confidence === "proven") {
    if (ev.advisories.length > 0) return `${word}. Advisory ${ev.advisories.slice(0, 3).join(", ")}.`;
    if (ev.rule) return `${word}. Rule ${ev.rule}.`;
  }
  if (finding.confidence === "judgment") return `${word}. birdsI's reading of the code, worth checking.`;
  return `${word}.`;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** The multi-line block from the terminal design, for Critical and High. */
export function findingBlock(finding: FindingLike, style: Style, number: number, numberWidth: number): string {
  const indent = " ".repeat(2 + numberWidth + 2 + stripAnsi(confidenceGlyph(finding.confidence, style)).length + 1);
  const lines = [
    `  ${paint.dim(style, String(number).padStart(numberWidth))}  ${paint.bold(style, confidenceGlyph(finding.confidence, style))} ${paint.bold(style, finding.title)}`,
  ];
  const where = locationText(finding);
  if (where) lines.push(indent + where);
  lines.push(indent + evidenceLine(finding));
  const status = statusNote(finding.status);
  if (status) lines.push(indent + paint.dim(style, `Status: ${status}.`));
  else if (finding.actionKind === "fix") lines.push(indent + paint.bold(style, "birdsI can fix this."));
  else lines.push(`${indent}${paint.bold(style, "You need to do this.")} Steps: ${paint.bold(style, `birdsi explain ${number}`)}`);
  return lines.join("\n");
}

/** Findings in display order: severity first, then the order the server returned. Numbers follow this order. */
export function orderFindings<T extends Pick<Finding, "severity">>(findings: readonly T[]): T[] {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.f.severity) - SEVERITY_ORDER.indexOf(b.f.severity) || a.i - b.i)
    .map(({ f }) => f);
}

export function countBy<K extends string>(items: readonly { [key: string]: unknown }[], key: string, keys: readonly K[]): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const item of items) {
    const value = item[key] as K;
    if (value in out) out[value] += 1;
  }
  return out;
}

/** "● 3 Proven   ◉ 5 Doc-verified   ◌ 4 Judgment", or the legend without counts. */
export function confidenceLegend(style: Style, counts?: Record<Confidence, number>): string {
  return CONFIDENCE_ORDER.map((c) =>
    counts ? `${confidenceGlyph(c, style)} ${counts[c]} ${CONFIDENCE_WORD[c]}` : `${confidenceGlyph(c, style)} ${CONFIDENCE_WORD[c]}`,
  ).join("   ");
}

/** "12 findings. birdsI can fix 7 of them. 5 need you." */
export function countsLine(total: number, fixable: number, needsYou: number): string {
  if (total === 0) return "No findings.";
  const head = `${plural(total, "finding")}.`;
  if (fixable === total) return `${head} birdsI can fix ${total === 1 ? "it" : total === 2 ? "both" : "all of them"}.`;
  if (fixable === 0) return `${head} ${total === 1 ? "It needs" : "They need"} you.`;
  return `${head} birdsI can fix ${fixable} of them. ${needsYou} ${needsYou === 1 ? "needs" : "need"} you.`;
}

/**
 * The summary after a scan: counts line, headline, Critical and High as
 * blocks, Medium and Low as numbered rows, and the confidence legend.
 */
export function formatScanReport(scan: Scan, findings: readonly Finding[], style: Style): string {
  const ordered = orderFindings(findings);
  const active = ordered.filter((f) => f.status !== "dismissed" && f.status !== "fixed");
  const fixable = active.filter((f) => f.actionKind === "fix").length;
  const lines: string[] = [];
  lines.push(paint.bold(style, countsLine(active.length, fixable, active.length - fixable)));
  if (scan.summary?.headline) lines.push(wrap(scan.summary.headline, style, ""));
  if (scan.audit) lines.push("", formatAudit(scan.audit, style));

  const width = String(ordered.length).length;
  for (const severity of SEVERITY_ORDER) {
    const group = ordered.map((f, i) => ({ f, n: i + 1 })).filter(({ f }) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push("", paintSeverity(severity, style));
    for (const { f, n } of group) {
      lines.push(
        severity === "critical" || severity === "high"
          ? findingBlock(f, style, n, width)
          : findingRow(f, style, { number: n, numberWidth: width, severity: false }),
      );
    }
  }
  if (ordered.length > 0) {
    lines.push("");
    lines.push(paint.dim(style, confidenceLegend(style, countBy(active, "confidence", CONFIDENCE_ORDER))));
    lines.push(paint.dim(style, "Details and steps for any finding: birdsi explain <number>"));
  }
  return lines.join("\n");
}

/** Findings list for "birdsi findings": every finding as a block, grouped by severity. */
export function formatFindingsList(findings: readonly Finding[], style: Style): string {
  const ordered = orderFindings(findings);
  if (ordered.length === 0) return "No findings in this scan.";
  const width = String(ordered.length).length;
  const lines: string[] = [];
  for (const severity of SEVERITY_ORDER) {
    const group = ordered.map((f, i) => ({ f, n: i + 1 })).filter(({ f }) => f.severity === severity);
    if (group.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(`${paintSeverity(severity, style)} ${paint.dim(style, String(group.length))}`);
    for (const { f, n } of group) lines.push(findingBlock(f, style, n, width));
  }
  lines.push("", paint.dim(style, confidenceLegend(style)));
  return lines.join("\n");
}

const AUDIT_AREA_WORD: Record<AuditReport["areas"][number]["area"], string> = {
  auth: "Sign-in and access",
  secrets: "Secrets",
  data: "Data",
  dependencies: "Dependencies",
  errors: "Error handling",
  config: "Configuration",
  legal: "Legal pages",
  tests: "Tests",
};

export const AUDIT_VERDICT_WORD = { pass: "Pass", attention: "Needs attention", blocker: "Blocker" } as const;

export function formatAuditArea(
  area: AuditReport["areas"][number]["area"],
  verdict: keyof typeof AUDIT_VERDICT_WORD,
  note: string,
  style: Style,
): string {
  const g = glyphs(style);
  const mark = verdict === "pass" ? paint.ok(style, g.done) : verdict === "blocker" ? paint.fail(style, g.failed) : paint.high(style, "!");
  return `  ${mark} ${AUDIT_AREA_WORD[area].padEnd(20)} ${AUDIT_VERDICT_WORD[verdict]}. ${note}`;
}

export function formatAudit(audit: AuditReport, style: Style): string {
  const verdict =
    audit.verdict === "ready" ? "Ready to launch." : audit.verdict === "not_ready" ? "Not ready to launch yet." : "The audit did not run.";
  const lines = [paint.bold(style, `Pre-launch audit: ${verdict}`)];
  if (audit.headline) lines.push(wrap(audit.headline, style, ""));
  for (const area of audit.areas) lines.push(formatAuditArea(area.area, area.verdict, area.note, style));
  return lines.join("\n");
}

/** Everything about one finding, in reading order. Used by "birdsi explain" and the MCP server. */
export function formatFindingDetail(finding: Finding, fix: Fix | null, style: Style, number?: number): string {
  const lines: string[] = [];
  const heading = `${confidenceGlyph(finding.confidence, style)} ${finding.title}`;
  lines.push(paint.bold(style, number !== undefined ? `${number}  ${heading}` : heading));
  lines.push(`${paintSeverity(finding.severity, style)}. ${CONFIDENCE_WORD[finding.confidence]}. ${CONFIDENCE_MEANING[finding.confidence]}`);
  const where = locationText(finding);
  if (where) lines.push(paint.dim(style, where));
  lines.push(paint.dim(style, `Finding ${finding.id}`));

  lines.push("", paint.bold(style, "What is wrong"), wrap(finding.explanation, style, "  "));
  lines.push("", paint.bold(style, "Why it matters"), wrap(finding.whyItMatters, style, "  "));

  const ev = finding.evidence;
  const evidence: string[] = [];
  if (ev.rule) evidence.push(wrap(`Rule: ${ev.rule}`, style, "  "));
  if (ev.advisories.length > 0) evidence.push(wrap(`Advisories: ${ev.advisories.join(", ")}`, style, "  "));
  if (ev.doc) {
    evidence.push(wrap(`${ev.doc.title}${ev.doc.publishedAt ? `, ${ev.doc.publishedAt}` : ""}`, style, "  "));
    evidence.push(`  ${ev.doc.url}`);
    evidence.push(wrap(`"${ev.doc.excerpt.trim()}"`, style, "    "));
  }
  if (ev.excerpt) {
    if (evidence.length > 0) evidence.push("");
    evidence.push(...ev.excerpt.replace(/\s+$/, "").split(/\r?\n/).map((l) => paint.dim(style, `    ${l}`)));
  }
  if (evidence.length > 0) lines.push("", paint.bold(style, "Evidence"), ...evidence);

  if (finding.actionKind === "fix" && finding.fixPlan) {
    lines.push("", paint.bold(style, "birdsI can fix this"));
    lines.push(wrap(finding.fixPlan.summary, style, "  "));
    if (finding.fixPlan.paths.length > 0) lines.push(wrap(`Files: ${finding.fixPlan.paths.join(", ")}`, style, "  "));
    if (finding.fixPlan.followUp.length > 0) {
      lines.push("  After the fix, you still need to:");
      for (const item of finding.fixPlan.followUp) lines.push(wrap(`- ${item}`, style, "    "));
    }
    if (!fix) lines.push(paint.dim(style, `  Start it: birdsi fix ${finding.id}`));
  }
  if (finding.steps.length > 0) {
    lines.push("", paint.bold(style, finding.actionKind === "fix" ? "Steps" : "What you need to do"));
    finding.steps.forEach((step, i) => {
      lines.push(wrap(`${i + 1}. ${step.title}`, style, "  "));
      if (step.detail) lines.push(wrap(step.detail, style, "     "));
      if (step.snippet) lines.push(...step.snippet.replace(/\s+$/, "").split(/\r?\n/).map((l) => `       ${l}`));
    });
  }
  if (fix) {
    lines.push("", paint.bold(style, "Fix"), `  ${fixStatusLine(fix)}`);
    if (fix.prUrl) lines.push(`  ${fix.prUrl}`);
  }
  if (finding.status !== "open") lines.push("", paint.dim(style, `Status: ${statusNote(finding.status) ?? finding.status}.`));
  return lines.join("\n");
}

export function fixStatusLine(fix: Fix): string {
  switch (fix.status) {
    case "proposed":
      return "Queued. birdsI is writing the fix.";
    case "testing":
      return "Testing the fix in a sandbox.";
    case "tested":
      return "Tested in a sandbox.";
    case "pr_open":
      return fix.prNumber ? `Pull request #${fix.prNumber} is open.` : "The pull request is open.";
    case "failed":
      return `The fix did not work${fix.error ? `: ${fix.error}` : "."}`;
  }
}

/** Last meaningful line of the sandbox log, e.g. "build passes, 38 of 38 tests pass". */
export function sandboxResult(fix: Fix): string | null {
  if (!fix.testLog) return null;
  const lines = fix.testLog
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const last = lines[lines.length - 1];
  if (!last) return null;
  return last.length > 160 ? `${last.slice(0, 157)}...` : last;
}

export function formatRepos(repos: readonly Repo[], style: Style): string {
  if (repos.length === 0) return "No repositories are connected. Connect one on the birdsI website.";
  const width = Math.max(...repos.map((r) => r.fullName.length));
  return repos
    .map((r) => `  ${r.fullName.padEnd(width)}  ${paint.dim(style, `${r.private ? "private" : "public "}  ${r.id}`)}`)
    .join("\n");
}
