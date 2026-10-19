import { describe, expect, it } from "vitest";
import { cockpitView, type AppAlert, type AppProject } from "@birdsi/shared";
import { alertsLines, cockpitLines } from "./cockpit";

const email = { on: true, sentence: "New alerts are emailed to o*****@example.com." };
const alert: AppAlert = {
  id: "a1",
  appId: "a",
  kind: "deployment_failed",
  severity: "critical",
  projectId: "p",
  sentence: "The newest production deployment of the Vercel project flowsophy-ops failed 2 hours ago.",
  action: "Open the deployment, fix the build, and push again.",
  details: {},
  source: { label: "x", url: null, path: null, line: null },
  dedupeKey: "deployment_failed:p:d1",
  scope: "deployment_failed:p",
  openedAt: "2026-10-18T19:00:00.000Z",
  seenAt: "2026-10-18T21:00:00.000Z",
  resolvedAt: null,
  emailStatus: "sent",
  emailedAt: "2026-10-18T19:00:05.000Z",
};
const project: AppProject = { id: "p", appId: "a", vendor: "vercel", kind: "project", ref: "flowsophy-ops", label: "ops", environment: null, plan: null, settings: {}, dashboardUrl: "https://vercel.com/x/flowsophy-ops", key: null, createdAt: "2026-10-18T00:00:00.000Z" };

describe("the cockpit in the terminal", () => {
  it("leads with the alerts and says why a project has no read", () => {
    const view = cockpitView({ appName: "Flowsophy", environments: ["production"], projects: [project], map: null, mapReason: "No service map of this app yet.", reads: new Map(), readsReason: null, alerts: [alert], alertsReason: null, email, vendors: [] });
    const lines = cockpitLines(view, (s) => `«${s}»`);
    expect(lines[0]).toBe("«Flowsophy»");
    expect(lines).toContain("Alerts (1 open, 1 critical):");
    expect(lines).toContain("- [critical] «The newest production deployment of the Vercel project flowsophy-ops failed 2 hours ago.» «Open the deployment, fix the build, and push again.»");
    expect(lines).toContain("Vercel project «flowsophy-ops (ops)»:");
    expect(lines.some((l) => l.includes("No key yet"))).toBe(true);
  });

  it("lists open and closed alerts and the dates to watch", () => {
    const lines = alertsLines({ alerts: [alert, { ...alert, id: "a2", resolvedAt: "2026-10-18T21:00:00.000Z" }], deadlines: [{ id: "d", appId: "a", vendor: null, label: "The Google credit ends", dueOn: "2026-12-08", note: null, createdAt: "2026-10-18T00:00:00.000Z" }], email, reason: null });
    expect(lines[0]).toBe("Open (1):");
    expect(lines).toContain("Closed in the last two weeks (1):");
    expect(lines).toContain("- 2026-12-08 The Google credit ends");
    expect(lines.at(-1)).toBe(email.sentence);
  });
});
