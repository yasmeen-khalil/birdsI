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

/** Flags that take the next word as their value, per program, so the value is not read as a subcommand. */
const VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  vercel: new Set(["--cwd", "--token", "-t", "--scope", "-S", "--team", "-T", "--local-config", "-A", "--global-config", "-Q", "--meta", "-m", "--env", "-e", "--build-env", "-b", "--target", "--regions"]),
  stripe: new Set(["--api-key", "--project-name", "-p", "--config", "--color", "--log-level", "--device-name", "--stripe-account"]),
  supabase: new Set(["--workdir", "--profile", "--project-ref", "--db-url", "-o", "--output"]),
  railway: new Set(["--service", "-s", "--environment", "-e", "--project", "-p"]),
  fly: new Set(["--app", "-a", "--config", "-c", "--access-token", "-t", "--org", "-o", "--region", "-r", "--image", "-i"]),
  flyctl: new Set(["--app", "-a", "--config", "-c", "--access-token", "-t", "--org", "-o", "--region", "-r", "--image", "-i"]),
  gh: new Set(["--repo", "-R", "--hostname", "--env", "-e", "--org", "-o", "--body", "-b", "--app", "-a"]),
  npm: new Set(["--prefix", "--registry", "--userconfig", "--workspace", "-w", "--tag", "--access", "--otp", "--cache"]),
};

/** Programs that only run the program after them. */
const WRAPPERS = new Set(["sudo", "time", "nohup", "exec", "command", "builtin", "nice", "doas"]);
const WRAPPER_VALUE_FLAGS = new Set(["-u", "-g", "-n", "-C", "-p", "--package", "-c", "--call", "-S", "--split-string", "--unset", "--chdir"]);

/** Splits a shell line on && || ; | & and newlines outside quotes, and pulls out $( ) and backtick substitutions. */
export function commandSegments(command: string, depth = 0): string[] {
  const out: string[] = [];
  if (depth > 4) return out;
  for (const m of command.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) out.push(...commandSegments(m[1] ?? m[2] ?? "", depth + 1));
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";" || ch === "\n" || ch === "|" || ch === "&") {
      out.push(current);
      current = "";
      if ((ch === "|" || ch === "&") && command[i + 1] === ch) i++;
      continue;
    }
    current += ch;
  }
  out.push(current);
  const segments: string[] = [];
  for (const raw of out) {
    const seg = raw.trim().replace(/^[({]\s*/, "").replace(/\s*[)}]$/, "").trim();
    if (!seg) continue;
    // bash -c "...", sh -c '...': the quoted text is the command that runs.
    const inner = seg.match(/^(?:\S*\/)?(?:bash|sh|zsh|dash)\s+(?:-\w*\s+)*-\w*c\w*\s+(["'])([\s\S]*)\1\s*$/);
    if (inner) segments.push(...commandSegments(inner[2]!, depth + 1));
    else segments.push(seg);
  }
  return segments;
}

function words(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^(["'])([\s\S]*)\1$/, "$2"));
}

/**
 * One simple command reduced to the program and its words, without the
 * wrappers in front (env, VAR=value, sudo, npx, bunx, pnpm dlx, a path to the
 * binary) and without flags, so "env X=1 npx vercel --cwd . env add" reads as
 * "vercel env add". The flags are returned separately.
 */
export function parseCommand(segment: string): { program: string; args: string[]; flags: string[] } {
  let w = words(segment);
  for (;;) {
    const first = w[0];
    if (first === undefined) break;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      w = w.slice(1);
      continue;
    }
    const base = first.split("/").pop()!;
    if (base === "env" || WRAPPERS.has(base)) {
      let i = 1;
      while (i < w.length && w[i]!.startsWith("-")) i += WRAPPER_VALUE_FLAGS.has(w[i]!) ? 2 : 1;
      w = w.slice(i);
      continue;
    }
    if (base === "npx" || base === "bunx") {
      let i = 1;
      while (i < w.length && w[i]!.startsWith("-")) i += WRAPPER_VALUE_FLAGS.has(w[i]!) ? 2 : 1;
      w = w.slice(i);
      continue;
    }
    if ((base === "pnpm" || base === "yarn" || base === "npm" || base === "bun") && (w[1] === "dlx" || w[1] === "exec" || w[1] === "x")) {
      let i = 2;
      while (i < w.length && w[i]!.startsWith("-")) i += WRAPPER_VALUE_FLAGS.has(w[i]!) ? 2 : 1;
      w = w.slice(i);
      continue;
    }
    // "yarn vercel ..." and "pnpm vercel ..." run the package's own binary.
    if ((base === "yarn" || base === "pnpm") && w[1] !== undefined && w[1] in VALUE_FLAGS) {
      w = w.slice(1);
      continue;
    }
    break;
  }
  const program = (w[0] ?? "").split("/").pop()!;
  const valueFlags = VALUE_FLAGS[program] ?? new Set<string>();
  const args: string[] = [];
  const flags: string[] = [];
  for (let i = 1; i < w.length; i++) {
    const word = w[i]!;
    if (word === "--") {
      args.push(...w.slice(i + 1));
      break;
    }
    if (word.startsWith("-") && word.length > 1) {
      if (!word.includes("=") && valueFlags.has(word) && i + 1 < w.length) {
        flags.push(`${word}=${w[i + 1]}`);
        i++;
      } else {
        flags.push(word);
      }
      continue;
    }
    args.push(word);
  }
  return { program, args, flags };
}

/** The first simple command in a line, as "program subcommand words", for display and tests. */
export function normalizeCommand(command: string): string {
  const first = commandSegments(command)[0] ?? "";
  const { program, args } = parseCommand(first);
  return [program, ...args].join(" ").trim();
}

/** A Vercel deploy to production: "vercel --prod", "vercel deploy --prod", "vercel deploy --target production". */
function isVercelProductionDeploy(parsed: { program: string; flags: string[] }): boolean {
  return parsed.program === "vercel" && parsed.flags.some((f) => f === "--prod" || f === "--production" || f === "--target=production");
}

/** The vendor a command changes, or null when it changes nothing. Every command in a shell line is checked. */
export function accountChange(command: string): string | null {
  for (const segment of commandSegments(command)) {
    const parsed = parseCommand(segment);
    if (isVercelProductionDeploy(parsed)) return "Vercel";
    const c = [parsed.program, ...parsed.args].join(" ");
    const vendor = ACCOUNT_CHANGING_COMMANDS.find((r) => r.pattern.test(c))?.vendor;
    if (vendor) return vendor;
  }
  return null;
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
  return { verdict: "propose", vendor, reason: `This changes the ${vendor} account. Propose it with birdsi_request_action (the exact command, the reason, the monthly cost) and wait for the owner's yes. It then runs on the owner's machine with birdsi approvals run. Do not run it here.` };
}
