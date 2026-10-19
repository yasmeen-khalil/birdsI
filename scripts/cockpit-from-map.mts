/**
 * Renders an app's cockpit in the terminal from a stored service map alone,
 * with optional declared projects and no reads, the way the cockpit shows an
 * app before any key is connected. Nothing leaves the computer.
 *
 *   npx tsx scripts/cockpit-from-map.mts <map.json> [<app name>] [vercel:<ref>:<label> ...]
 */
import { readFile } from "node:fs/promises";
import { cockpitView, ServiceMap, type AppProject } from "../packages/shared/src/index";
import { cockpitLines } from "../packages/cli/src/cockpit";

const [file, appName = "The app", ...declared] = process.argv.slice(2);
if (!file) {
  process.stderr.write("Usage: npx tsx scripts/cockpit-from-map.mts <map.json> [app name] [vendor:ref:label ...]\n");
  process.exit(5);
}
const map = ServiceMap.parse(JSON.parse(await readFile(file, "utf8")));
const projects: AppProject[] = declared.map((d, i) => {
  const [vendor = "vercel", ref = `project-${i}`, label = null] = d.split(":");
  const kind = vendor === "onesignal" ? "app" : "project";
  return { id: `p${i}`, appId: "a", vendor, kind, ref, label, environment: null, plan: null, settings: {}, dashboardUrl: "", key: null, createdAt: map.readAt } as AppProject;
});
const view = cockpitView({
  appName,
  environments: ["production"],
  projects,
  map: { appId: null, repoId: "local", scanId: null, createdAt: map.readAt, map },
  mapReason: null,
  reads: new Map(),
  readsReason: null,
  alerts: [],
  alertsReason: null,
  email: { on: false, sentence: "Alerts are not emailed: RESEND_API_KEY is not set on birdsI." },
  vendors: [],
});
process.stdout.write(cockpitLines(view).join("\n") + "\n");
