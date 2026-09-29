import type { Finding } from "@birdsi/shared";
import { describe, expect, it } from "vitest";
import {
  PLAIN,
  countsLine,
  findingBlock,
  findingRow,
  formatDuration,
  orderFindings,
  stripAnsi,
  supportsColor,
  supportsUnicode,
  type Style,
} from "./format";
import { patchedFiles, stripLevel } from "./patch";
import { stepDoneLine, truncateVisible } from "./progress";
import { isYes } from "./prompt";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    scanId: "s1",
    repoId: null,
    key: "k",
    checkId: "secrets.committed",
    title: "Your database key is committed in .env.production",
    explanation: "e",
    whyItMatters: "w",
    severity: "critical",
    confidence: "proven",
    category: "security",
    location: { path: ".env.production", lineStart: 3 },
    evidence: { advisories: [], rule: "supabase-service-role-key" },
    actionKind: "fix",
    steps: [],
    fixPlan: null,
    status: "open",
    createdAt: "2026-09-28T00:00:00Z",
    ...overrides,
  };
}

const ASCII: Style = { color: false, unicode: false, width: undefined };
const COLOR: Style = { color: true, unicode: true, width: undefined };

describe("findingRow", () => {
  it("prints severity, confidence glyph, title and path:line on one line", () => {
    expect(findingRow(finding(), PLAIN)).toBe("  critical ● Your database key is committed in .env.production  .env.production:3");
  });

  it("uses the glyph for each confidence class", () => {
    expect(findingRow(finding({ confidence: "doc_verified", severity: "high" }), PLAIN)).toContain("high     ◉ ");
    expect(findingRow(finding({ confidence: "judgment", severity: "low" }), PLAIN)).toContain("low      ◌ ");
  });

  it("falls back to [P] [D] [J] without Unicode", () => {
    expect(findingRow(finding(), ASCII)).toContain("critical [P] Your");
    expect(findingRow(finding({ confidence: "doc_verified" }), ASCII)).toContain("[D]");
    expect(findingRow(finding({ confidence: "judgment" }), ASCII)).toContain("[J]");
  });

  it("numbers rows under a severity heading without repeating the severity", () => {
    const row = findingRow(finding({ severity: "medium", location: { path: "a.ts" } }), PLAIN, { number: 7, numberWidth: 2, severity: false });
    expect(row).toBe("   7  ● Your database key is committed in .env.production  a.ts");
  });

  it("leaves out the location when there is none, and notes a non-open status", () => {
    const row = findingRow(finding({ location: null, status: "dismissed" }), PLAIN);
    expect(row).toBe("  critical ● Your database key is committed in .env.production  (dismissed)");
  });

  it("colours only when asked, and the text reads the same without colour", () => {
    const row = findingRow(finding(), COLOR);
    expect(row).toContain("\x1b[");
    expect(stripAnsi(row)).toBe(findingRow(finding(), PLAIN));
  });

  it("never prints an em dash", () => {
    expect(findingRow(finding(), PLAIN)).not.toContain("\u2014");
    expect(findingBlock(finding(), PLAIN, 1, 1)).not.toContain("\u2014");
  });
});

describe("findingBlock", () => {
  it("matches the terminal design for a fixable proven finding", () => {
    expect(findingBlock(finding(), PLAIN, 1, 1)).toBe(
      [
        "  1  ● Your database key is committed in .env.production",
        "       .env.production:3",
        "       Proven. Rule supabase-service-role-key.",
        "       birdsI can fix this.",
      ].join("\n"),
    );
  });

  it("points at the steps when the user has to act", () => {
    const block = findingBlock(
      finding({
        confidence: "doc_verified",
        actionKind: "steps",
        evidence: { advisories: [], doc: { url: "https://supabase.com/docs/guides/rls", title: "Supabase, Row Level Security", excerpt: "..." } },
      }),
      PLAIN,
      4,
      1,
    );
    expect(block).toContain("Doc-verified. Supabase, Row Level Security, supabase.com/docs/guides/rls.");
    expect(block).toContain("You need to do this. Steps: birdsi explain 4");
  });
});

describe("summary helpers", () => {
  it("orders by severity and keeps server order within a severity", () => {
    const list = [
      finding({ id: "a", severity: "low" }),
      finding({ id: "b", severity: "critical" }),
      finding({ id: "c", severity: "medium" }),
      finding({ id: "d", severity: "critical" }),
    ];
    expect(orderFindings(list).map((f) => f.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("writes the counts line like the design", () => {
    expect(countsLine(12, 7, 5)).toBe("12 findings. birdsI can fix 7 of them. 5 need you.");
    expect(countsLine(0, 0, 0)).toBe("No findings.");
    expect(countsLine(1, 1, 0)).toBe("1 finding. birdsI can fix it.");
    expect(countsLine(3, 0, 3)).toBe("3 findings. They need you.");
  });

  it("formats durations", () => {
    expect(formatDuration(3000)).toBe("3s");
    expect(formatDuration(168_000)).toBe("2m 48s");
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });

  it("lays out a finished step in the design's columns", () => {
    const line = stepDoneLine({ step: "inventory", label: "Read the repository", done: 212, total: undefined, findings: 0, durationMs: 3000 }, PLAIN);
    expect(line).toBe("  ✓ Read the repository          212 files          3s");
    const vuln = stepDoneLine({ step: "review", label: "Read the code", done: 212, total: 212, findings: 0, durationMs: 168_000 }, PLAIN);
    expect(vuln).toBe("  ✓ Read the code                212 files      2m 48s");
  });

  it("truncates to the terminal width without breaking escapes", () => {
    const cut = truncateVisible("\x1b[2mabcdefghij\x1b[0m", 5);
    expect(stripAnsi(cut)).toBe("abcd.");
  });
});

describe("terminal detection", () => {
  it("detects Unicode support from the locale and terminal", () => {
    expect(supportsUnicode({ LANG: "en_US.UTF-8" }, "darwin")).toBe(true);
    expect(supportsUnicode({ LANG: "C" }, "linux")).toBe(false);
    expect(supportsUnicode({ TERM: "linux", LANG: "en_US.UTF-8" }, "linux")).toBe(false);
    expect(supportsUnicode({}, "win32")).toBe(false);
    expect(supportsUnicode({ WT_SESSION: "1" }, "win32")).toBe(true);
  });

  it("uses colour only on a terminal without NO_COLOR", () => {
    const tty = { isTTY: true } as NodeJS.WriteStream;
    const pipe = { isTTY: false } as NodeJS.WriteStream;
    expect(supportsColor(tty, {})).toBe(true);
    expect(supportsColor(tty, { NO_COLOR: "1" })).toBe(false);
    expect(supportsColor(pipe, {})).toBe(false);
  });
});

describe("prompt and patch helpers", () => {
  it("treats only y and yes as yes; Enter means no", () => {
    expect(isYes("y")).toBe(true);
    expect(isYes(" YES ")).toBe(true);
    expect(isYes("")).toBe(false);
    expect(isYes("n")).toBe(false);
    expect(isYes("yep")).toBe(false);
  });

  it("lists the files a patch touches, including deletions", () => {
    const patch = [
      "diff --git a/.gitignore b/.gitignore",
      "--- a/.gitignore",
      "+++ b/.gitignore",
      "@@ -1 +1,2 @@",
      " node_modules",
      "+.env*",
      "diff --git a/.env.production b/.env.production",
      "deleted file mode 100644",
      "--- a/.env.production",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-KEY=1",
    ].join("\n");
    expect(patchedFiles(patch)).toEqual([".gitignore", ".env.production"]);
    expect(stripLevel(patch)).toBe(1);
    expect(stripLevel(patch.replaceAll("a/", "a/snapshot/").replaceAll("b/", "b/snapshot/"))).toBe(2);
  });
});
