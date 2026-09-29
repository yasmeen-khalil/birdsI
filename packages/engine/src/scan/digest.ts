import type { Dependency } from "@birdsi/shared";
import type { Inventory } from "../inventory/walk";

/**
 * A compact description of the repository that goes at the top of every
 * model prompt, so a file is always read in the context of the whole.
 */
export interface RepoDigest {
  text: string;
  frameworks: string[];
}

const FRAMEWORK_HINTS: Array<[RegExp, string]> = [
  [/^next$/, "Next.js"],
  [/^react$/, "React"],
  [/^vue$/, "Vue"],
  [/^nuxt$/, "Nuxt"],
  [/^svelte$/, "Svelte"],
  [/^@sveltejs\/kit$/, "SvelteKit"],
  [/^astro$/, "Astro"],
  [/^express$/, "Express"],
  [/^fastify$/, "Fastify"],
  [/^hono$/, "Hono"],
  [/^@nestjs\/core$/, "NestJS"],
  [/^@supabase\/supabase-js$/, "Supabase"],
  [/^@prisma\/client$/, "Prisma"],
  [/^drizzle-orm$/, "Drizzle"],
  [/^mongoose$/, "Mongoose"],
  [/^@clerk\//, "Clerk"],
  [/^next-auth$/, "NextAuth"],
  [/^stripe$/, "Stripe"],
  [/^django$/i, "Django"],
  [/^flask$/i, "Flask"],
  [/^fastapi$/i, "FastAPI"],
  [/^rails$/, "Rails"],
  [/^laravel\/framework$/, "Laravel"],
  [/^gin-gonic\/gin$/, "Gin"],
  [/^actix-web$/, "Actix"],
  [/^axum$/, "Axum"],
  [/^expo$/, "Expo"],
  [/^react-native$/, "React Native"],
  [/^flutter$/, "Flutter"],
];

export function buildDigest(inventory: Inventory, dependencies: Dependency[], appDescription: string | null): RepoDigest {
  const frameworks = new Set<string>();
  for (const dep of dependencies) {
    for (const [re, name] of FRAMEWORK_HINTS) if (re.test(dep.name) || re.test(dep.name.split("/").pop() ?? "")) frameworks.add(name);
  }
  const tree = renderTree(inventory);
  const langs = inventory.languages.slice(0, 8).map((l) => `${l.name} (${l.files})`).join(", ");
  const directDeps = dependencies.filter((d) => d.direct);
  const depLine = directDeps
    .slice(0, 60)
    .map((d) => `${d.name}@${d.versionInUse}`)
    .join(", ");
  const text = [
    appDescription ? `What the owner says the app does: ${appDescription.slice(0, 600)}` : null,
    `Languages: ${langs || "none detected"}.`,
    frameworks.size > 0 ? `Frameworks and services detected: ${[...frameworks].join(", ")}.` : null,
    `Direct dependencies (${directDeps.length}): ${depLine}${directDeps.length > 60 ? ", ..." : ""}`,
    `Files: ${inventory.files.length}. Tree (folders and notable files):\n${tree}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { text, frameworks: [...frameworks] };
}

/** Folder-level tree with the first few files of each folder; bounded so it fits any prompt. */
function renderTree(inventory: Inventory, maxLines = 120): string {
  const lines: string[] = [];
  const byDir = new Map<string, string[]>();
  for (const file of inventory.files) {
    const parts = file.path.split("/");
    const dir = parts.length > 1 ? parts.slice(0, Math.min(parts.length - 1, 3)).join("/") : ".";
    const list = byDir.get(dir) ?? [];
    list.push(parts[parts.length - 1]!);
    byDir.set(dir, list);
  }
  const dirs = [...byDir.keys()].sort();
  for (const dir of dirs) {
    if (lines.length >= maxLines) {
      lines.push(`... and ${dirs.length - lines.length} more folders`);
      break;
    }
    const files = byDir.get(dir)!;
    const shown = files.slice(0, 6).join(", ");
    lines.push(`${dir}/ (${files.length}): ${shown}${files.length > 6 ? ", ..." : ""}`);
  }
  return lines.join("\n");
}

/** Numbers each line so the model can cite exact locations. */
export function numberLines(content: string, startAt = 1): string {
  return content
    .split("\n")
    .map((line, i) => `${String(i + startAt).padStart(5, " ")}  ${line}`)
    .join("\n");
}
