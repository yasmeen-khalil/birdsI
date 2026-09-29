import { isCodeLanguage, isConfigLanguage } from "./languages";
import type { InventoryFile } from "./walk";

/**
 * Orders files by how likely they are to hold something that matters, so a
 * budget-limited scan reads the most important files first. Entry points,
 * auth, API routes, config and anything touching secrets or money come
 * first; tests, generated code and docs come last.
 */
const HIGH = [
  /(^|\/)(auth|login|session|token|oauth|password|permission|role|acl)/i,
  /(^|\/)(api|routes?|controllers?|handlers?|endpoints?|server|middleware|proxy)(\/|\.)/i,
  /(^|\/)(payment|billing|stripe|checkout|webhook|subscription)/i,
  /(^|\/)(db|database|prisma|schema|migrations?|models?|supabase|drizzle)(\/|\.)/i,
  /(^|\/)(config|settings|env|secrets?)(\/|\.)/i,
  /(^|\/)(upload|storage|file|s3|bucket)/i,
  /(^|\/)(admin|dashboard)/i,
  /(^|\/)(main|index|app|server|entry)\.[a-z]+$/i,
  /(^|\/)(next|nuxt|vite|webpack|tsconfig|package)\.(config\.)?[a-z]+$/i,
  /(^|\/)(Dockerfile|docker-compose\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|railway\.json)$/i,
  /(^|\/)\.env/i,
  /(^|\/)\.github\/workflows\//i,
];

const LOW = [
  /(^|\/)(__tests__|tests?|spec|e2e|fixtures?|mocks?|stories)(\/|\.)/i,
  /\.(test|spec|stories)\.[a-z]+$/i,
  /(^|\/)(docs?|examples?|samples?)\//i,
  /\.d\.ts$/,
  /(^|\/)(generated|gen|codegen|__generated__)\//i,
  /\.(md|mdx|txt|csv)$/i,
  /(^|\/)(locales?|i18n|translations?)\//i,
];

export function priorityOf(file: InventoryFile): number {
  let score = 0;
  if (isCodeLanguage(file.language)) score += 40;
  else if (isConfigLanguage(file.language)) score += 25;
  else score += 5;
  for (const re of HIGH) if (re.test(file.path)) score += 30;
  for (const re of LOW) if (re.test(file.path)) score -= 35;
  // Very small files rarely hold logic; huge ones cost more than they return.
  if (file.bytes < 120) score -= 20;
  if (file.bytes > 60_000) score -= 15;
  const depth = file.path.split("/").length;
  score -= Math.min(depth, 6) * 2;
  return score;
}

export function prioritise(files: InventoryFile[]): InventoryFile[] {
  return files
    .map((file) => ({ file, score: priorityOf(file) }))
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .map((x) => x.file);
}
