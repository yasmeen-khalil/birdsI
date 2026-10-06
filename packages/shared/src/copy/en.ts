/**
 * User-facing words shared by every surface. One word per concept, applied
 * everywhere; the internal names in domain.ts never change even when these do.
 */
export const en = {
  product: "birdsI",
  confidence: {
    proven: "Proven",
    doc_verified: "Doc-verified",
    judgment: "Judgment",
  },
  confidenceExplained: {
    proven: "A fixed rule or tool found it, not a model. Run it again and you get the same answer.",
    doc_verified: "Checked against the current official docs, which are cited so you can read them too.",
    judgment: "birdsI's reading of your code. Usually right, worth a look before acting.",
  },
  severity: {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
  },
  scanKind: {
    light: "Quick check",
    deep: "Full scan",
    audit: "Pre-launch audit",
  },
  scanKindDuration: {
    light: "About 2 min",
    deep: "10 to 20 min",
    audit: "20 to 40 min",
  },
  scanStatus: {
    queued: "Queued",
    running: "Running",
    done: "Done",
    failed: "Failed",
    stopped: "Stopped",
  },
  actionKind: {
    fix: "birdsI can fix this",
    steps: "You need to do this",
  },
  findingStatus: {
    open: "Open",
    pr_open: "Pull request open",
    fixed: "Fixed",
    dismissed: "Dismissed",
  },
  auditArea: {
    auth: "Sign-in and permissions",
    secrets: "Keys and secrets",
    data: "User data",
    dependencies: "Packages",
    errors: "Failure handling",
    config: "Deployment settings",
    legal: "Legal pages",
    tests: "Tests and checks",
    operations: "Services and limits",
  },
  auditVerdict: {
    ready: "Ready to launch.",
    not_ready: "Not ready to launch yet.",
    not_run: "The pre-launch audit has not run yet.",
  },
  areaVerdict: {
    pass: "Pass",
    attention: "Needs attention",
    blocker: "Blocker",
  },
  step: {
    fetch: "Fetch the code",
    inventory: "Read the repository",
    dependencies: "Map dependencies",
    vendors: "Find the services it runs on",
    secrets: "Look for exposed keys and unsafe settings",
    vulnerabilities: "Check known problems",
    docs: "Check against current docs",
    review: "Read the code",
    crosscheck: "Compare files against each other",
    audit: "Judge launch readiness",
    rank: "Verify and sort findings",
  },
  fixStatus: {
    proposed: "Writing the change",
    testing: "Testing on a separate copy",
    tested: "Tested",
    pr_open: "Pull request open",
    failed: "Could not fix",
  },
  actions: {
    openPullRequest: "Open a pull request",
    checkAgain: "Check again",
    stopScan: "Stop scan",
    signInWithGithub: "Sign in with GitHub",
    scanSample: "Scan a sample repo",
    dismiss: "Dismiss",
    reopen: "Reopen",
    keep: "Keep",
  },
} as const;

export type Copy = typeof en;
