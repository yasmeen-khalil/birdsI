/**
 * User-facing words shared by every surface. One word per concept, applied
 * everywhere; the internal names in domain.ts never change even when these do.
 */
export const en = {
  product: "birdsI",
  noun: "the cockpit for your apps",
  confidence: {
    proven: "Proven",
    doc_verified: "Doc-verified",
    judgment: "Judgment",
  },
  confidenceExplained: {
    proven: "A fixed rule or tool found it, not a model. Run it again and you get the same answer.",
    doc_verified: "Checked against the current official docs, which are cited so you can read them too.",
    judgment: "A model's reading of the code, from before birdsI stopped reading code with a model. Check it before acting.",
  },
  severity: {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
  },
  scan: {
    name: "Map",
    action: "Map the code",
    duration: "Under a minute",
  },
  scanStatus: {
    queued: "Queued",
    running: "Running",
    done: "Done",
    failed: "Failed",
    stopped: "Stopped",
  },
  actionKind: {
    fix: "A code change fixes this",
    steps: "Needs you outside the code",
  },
  findingStatus: {
    open: "Open",
    pr_open: "Pull request open",
    fixed: "Fixed",
    dismissed: "Dismissed",
  },
  step: {
    fetch: "Fetch the code",
    inventory: "Read the repository",
    dependencies: "Map dependencies",
    vendors: "Find the services it runs on",
    map: "Map deployments, crons, webhooks and migrations",
    secrets: "Look for exposed keys and unsafe settings",
    vulnerabilities: "Check known problems",
    docs: "Check against current docs",
    rank: "Verify and sort findings",
  },
  actions: {
    checkAgain: "Check again",
    stopScan: "Stop",
    signInWithGithub: "Sign in with GitHub",
    dismiss: "Dismiss",
    reopen: "Reopen",
    keep: "Keep",
  },
} as const;

export type Copy = typeof en;
