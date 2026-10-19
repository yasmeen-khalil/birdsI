import { describe, expect, it } from "vitest";
import type { AlertDraft } from "@birdsi/shared";
import { planAlertSync } from "./alerts";

function draft(dedupeKey: string): AlertDraft {
  return { kind: "env_missing", severity: "warning", projectId: "p", sentence: dedupeKey, action: null, details: {}, source: { label: "x", url: null, path: null, line: null }, dedupeKey, scope: dedupeKey.split(":").slice(0, 2).join(":") };
}

describe("one run of the alert stream", () => {
  it("opens new causes, refreshes the ones still there, closes what a checked scope no longer finds, and leaves what it could not check", () => {
    const open = [
      { id: "a1", dedupe_key: "env_missing:p:production:CRON_SECRET", scope: "env_missing:p" },
      { id: "a2", dedupe_key: "env_missing:p:production:RESEND_API_KEY", scope: "env_missing:p" },
      { id: "a3", dedupe_key: "migration_owed:db:0002_social.sql", scope: "migration_owed:db" },
    ];
    const drafts = [draft("env_missing:p:production:CRON_SECRET"), draft("env_missing:p:production:DEV_USER_IDS"), draft("env_missing:p:production:DEV_USER_IDS")];
    const plan = planAlertSync(open, drafts, ["env_missing:p"]);
    expect(plan.toOpen.map((d) => d.dedupeKey)).toEqual(["env_missing:p:production:DEV_USER_IDS"]);
    expect(plan.toRefresh.map((r) => r.id)).toEqual(["a1"]);
    // RESEND_API_KEY is set now: closed. The migration was not checked this run (the database was paused): left open.
    expect(plan.toResolve).toEqual(["a2"]);
  });
});
