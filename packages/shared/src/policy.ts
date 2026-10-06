import type { AgentPolicy } from "./ops";

/**
 * Vendor commands that change an account, a plan, money, secrets or a
 * deployment. An agent proposes these through birdsI and the owner approves;
 * everything else (reads, status, logs, local builds) passes untouched.
 */
export const ACCOUNT_CHANGING_COMMANDS: ReadonlyArray<{ vendor: string; pattern: RegExp }> = [
  { vendor: "Stripe", pattern: /^stripe\s+(projects\s+(upgrade|downgrade|limit|set|provision|delete)|subscriptions?\s+(create|update|cancel)|prices?\s+create|products?\s+(create|delete)|refunds?\s+create)\b/ },
  { vendor: "Vercel", pattern: /^vercel\s+(env\s+(add|rm|remove)|domains?\s+(add|rm|remove|move)|promote|rollback|redeploy|remove|rm|teams?\s+switch|billing|projects?\s+rm)\b/ },
  { vendor: "Supabase", pattern: /^supabase\s+(projects?\s+(create|delete|pause|restore)|db\s+(push|reset)|secrets\s+(set|unset)|functions\s+(deploy|delete)|link|orgs?\s+create|branches?\s+(create|delete))\b/ },
  { vendor: "Railway", pattern: /^railway\s+(up|redeploy|variables?\s+(set|delete)|service\s+delete|down|environment\s+delete|volume\s+delete)\b/ },
  { vendor: "Fly.io", pattern: /^(fly|flyctl)\s+(deploy|scale|secrets\s+(set|unset)|machines?\s+(destroy|stop|start|update)|apps?\s+destroy)\b/ },
  { vendor: "GitHub", pattern: /^gh\s+(repo\s+delete|secret\s+(set|delete|remove)|release\s+(create|delete)|variable\s+(set|delete))\b/ },
  { vendor: "npm", pattern: /^npm\s+(publish|unpublish|deprecate|owner)\b/ },
];

export interface PolicyVerdict {
  verdict: "allow" | "propose";
  vendor: string | null;
  reason: string;
}

/** Strips a leading npx, bunx or dlx and collapses spaces, so "npx vercel env add" reads as "vercel env add". */
export function normalizeCommand(command: string): string {
  return command
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(npx|bunx)\s+(-y\s+)?/, "")
    .replace(/^(pnpm|yarn)\s+dlx\s+/, "");
}

/** The vendor a command changes, or null when it changes nothing. */
export function accountChange(command: string): string | null {
  const c = normalizeCommand(command);
  return ACCOUNT_CHANGING_COMMANDS.find((r) => r.pattern.test(c))?.vendor ?? null;
}

/**
 * The hook's decision. An account-changing command is never run straight
 * from an agent's shell: it goes through birdsI, where the owner's policy
 * decides between auto-approval and a question, and then runs on the owner's
 * machine. The policy only changes the wording here.
 */
export function checkCommand(command: string, policy: Pick<AgentPolicy, "allowPropose"> | null): PolicyVerdict {
  const vendor = accountChange(command);
  if (!vendor) return { verdict: "allow", vendor: null, reason: "Not an account change." };
  if (policy && !policy.allowPropose) {
    return { verdict: "propose", vendor, reason: `This changes the ${vendor} account, and agents may not propose commands in this repository. Tell the owner what you would run and why, and let them run it.` };
  }
  return { verdict: "propose", vendor, reason: `This changes the ${vendor} account. Propose it with birdsi_request_action (the exact command, the reason, the monthly cost) and wait for the owner's yes; it then runs on the owner's machine with birdsi approvals run. Do not run it here.` };
}
