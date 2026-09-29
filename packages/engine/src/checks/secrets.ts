import { basename } from "node:path";
import { findingKey, type FindingDraft } from "@birdsi/shared";
import type { Check, CheckContext } from "./types";

interface SecretRule {
  id: string;
  name: string;
  pattern: RegExp;
  /** What the value unlocks, in plain words. */
  unlocks: string;
  /** Extra condition on the line and path, for shapes shared by two providers. */
  when?: (line: string, path: string) => boolean;
}

/**
 * Secret shapes with a known prefix or structure. Each is a rule, so a false
 * positive can be fixed in one place. Entropy-only detection is deliberately
 * not used: it is too noisy for a Proven finding.
 */
const RULES: SecretRule[] = [
  { id: "aws-access-key", name: "AWS access key", pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/, unlocks: "your AWS account" },
  { id: "github-token", name: "GitHub token", pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/, unlocks: "your GitHub account and repositories" },
  { id: "stripe-secret", name: "Stripe secret key", pattern: /\bsk_(live|test)_[A-Za-z0-9]{20,}\b/, unlocks: "your Stripe account, including charges and refunds", when: (line, path) => !/clerk/i.test(line + path) },
  { id: "stripe-webhook", name: "Stripe webhook secret", pattern: /\bwhsec_[A-Za-z0-9]{24,}\b/, unlocks: "forging payment events to your app" },
  { id: "openai-key", name: "OpenAI API key", pattern: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/, unlocks: "billing on your OpenAI account" },
  { id: "anthropic-key", name: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/, unlocks: "billing on your Anthropic account" },
  { id: "google-api-key", name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, unlocks: "Google APIs billed to your project" },
  { id: "slack-token", name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, unlocks: "your Slack workspace" },
  { id: "tavily-key", name: "Tavily API key", pattern: /\btvly-[A-Za-z0-9_-]{20,}\b/, unlocks: "billing on your Tavily account" },
  { id: "langsmith-key", name: "LangSmith API key", pattern: /\blsv2_(pt|sk)_[A-Za-z0-9_-]{20,}\b/, unlocks: "your LangSmith traces and projects" },
  { id: "supabase-secret", name: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/, unlocks: "your whole Supabase database, bypassing every access rule" },
  { id: "supabase-service-jwt", name: "Supabase service role key", pattern: /\beyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/, unlocks: "your whole Supabase database if the token carries the service_role claim" },
  { id: "private-key-block", name: "Private key", pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, unlocks: "whatever this key signs or decrypts" },
  { id: "database-url", name: "Database connection string with a password", pattern: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:'"]+:[^\s@'"]+@[^\s'"]+/i, unlocks: "your database directly" },
  { id: "twilio-key", name: "Twilio API key", pattern: /\bSK[0-9a-fA-F]{32}\b/, unlocks: "sending messages billed to your Twilio account" },
  { id: "sendgrid-key", name: "SendGrid API key", pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/, unlocks: "sending email as your domain" },
  { id: "clerk-secret", name: "Clerk secret key", pattern: /\bsk_(live|test)_[A-Za-z0-9]{20,}\b/, unlocks: "your users' accounts and sessions", when: (line, path) => /clerk/i.test(line + path) },
  { id: "vercel-token", name: "Vercel token", pattern: /\bvercel_[A-Za-z0-9]{24,}\b/i, unlocks: "your Vercel deployments" },
  { id: "npm-token", name: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/, unlocks: "publishing packages under your npm account" },
];

/** Words inside the value itself that mark a documentation sample rather than a real key. */
const PLACEHOLDER_VALUE = /(example|sample|placeholder|your[-_]?|xxx|changeme|dummy|test[-_]?key|0000000000)/i;
/** Line shapes that read a value from somewhere else instead of holding it. */
const PLACEHOLDER_LINE = /(<[^>]+>|\$\{|process\.env|os\.environ|getenv\()/i;

function isEnvFile(path: string): boolean {
  const name = basename(path);
  return name.startsWith(".env") && !name.endsWith(".example") && !name.endsWith(".sample") && !name.endsWith(".template");
}

export const secretsCheck: Check = {
  id: "secrets",
  step: "secrets",
  label: "Looking for keys and passwords committed to the code",
  tiers: ["light", "deep", "audit"],
  available: () => true,
  async run(ctx: CheckContext): Promise<FindingDraft[]> {
    const findings: FindingDraft[] = [];
    const candidates = ctx.inventory.files.filter((f) => f.bytes < 512_000);
    let done = 0;
    for (const file of candidates) {
      if (ctx.signal.aborted) break;
      done += 1;
      if (done % 50 === 0) await ctx.emit({ type: "step_progress", step: "secrets", done, total: candidates.length });
      const content = await ctx.read(file.path);
      const lines = content.split("\n");
      const seen = new Set<string>();
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.length > 2000) continue;
        for (const rule of RULES) {
          if (seen.has(rule.id)) continue;
          const match = line.match(rule.pattern);
          if (!match) continue;
          if (!rule.id.startsWith("private-key") && (PLACEHOLDER_VALUE.test(match[0]) || PLACEHOLDER_LINE.test(line))) continue;
          if (rule.when && !rule.when(line, file.path)) continue;
          seen.add(rule.id);
          const committedEnv = isEnvFile(file.path);
          findings.push({
            key: findingKey({ checkId: "secrets", path: file.path, subject: rule.id }),
            checkId: "secrets",
            title: committedEnv
              ? `A ${rule.name} is committed in ${file.path}`
              : `A ${rule.name} is written into ${file.path}`,
            explanation: `Line ${i + 1} of ${file.path} contains what looks like a real ${rule.name}. Anyone who can read this repository can use it. ${committedEnv ? "Files named .env are meant to stay on your machine and in your hosting settings, never in git." : "Keys belong in environment variables, read at runtime."}`,
            whyItMatters: `This key unlocks ${rule.unlocks}. If the repository is or ever becomes public, or a collaborator's machine is compromised, the key is exposed. Rotating it is the only way to close that door.`,
            severity: "critical",
            confidence: "proven",
            category: "security",
            location: { path: file.path, lineStart: i + 1, lineEnd: i + 1 },
            evidence: {
              excerpt: redact(line, match[0]),
              advisories: [],
              rule: `Pattern match for ${rule.name} (rule ${rule.id})`,
            },
            actionKind: committedEnv ? "steps" : "fix",
            steps: [
              { title: `Rotate the ${rule.name} now`, detail: "Create a new key in the provider's dashboard and revoke this one. The old value stays in git history even after it is removed." },
              committedEnv
                ? { title: `Remove ${file.path} from git and ignore it`, snippet: `git rm --cached ${file.path}\nprintf '\\n${basename(file.path)}\\n' >> .gitignore\ngit commit -m "Stop tracking ${basename(file.path)}"`, snippetLanguage: "bash" }
                : { title: "Move the value to an environment variable", detail: "Read it with process.env (or your language's equivalent) and set it in your hosting provider's environment settings." },
            ],
            fixPlan: committedEnv
              ? null
              : {
                  summary: `Replace the literal ${rule.name} with an environment variable read, and add the variable name to .env.example.`,
                  paths: [file.path, ".env.example"],
                  followUp: [`Rotate the ${rule.name} and set the new value in your hosting environment.`],
                },
          });
        }
      }
    }
    return findings;
  },
};

/** Keeps the first and last few characters so the user can recognise the key without it being copyable. */
export function redact(line: string, secret: string): string {
  const head = secret.slice(0, 6);
  const tail = secret.slice(-3);
  const masked = `${head}${"*".repeat(Math.max(4, Math.min(12, secret.length - 9)))}${tail}`;
  return line.replace(secret, masked).trim().slice(0, 200);
}
