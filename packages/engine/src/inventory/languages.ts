import { extname, basename } from "node:path";

/** Language by file extension. The engine reads any language; this only labels files. */
const BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".astro": "Astro",
  ".py": "Python",
  ".pyi": "Python",
  ".rb": "Ruby",
  ".erb": "Ruby",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".scala": "Scala",
  ".cs": "C#",
  ".fs": "F#",
  ".php": "PHP",
  ".swift": "Swift",
  ".m": "Objective-C",
  ".dart": "Dart",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".erl": "Erlang",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".cc": "C++",
  ".hpp": "C++",
  ".lua": "Lua",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".ps1": "PowerShell",
  ".sql": "SQL",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "CSS",
  ".less": "CSS",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".xml": "XML",
  ".md": "Markdown",
  ".mdx": "Markdown",
  ".tf": "Terraform",
  ".hcl": "Terraform",
  ".proto": "Protobuf",
  ".graphql": "GraphQL",
  ".gql": "GraphQL",
  ".prisma": "Prisma",
};

const BY_NAME: Record<string, string> = {
  Dockerfile: "Docker",
  Makefile: "Make",
  Gemfile: "Ruby",
  Rakefile: "Ruby",
  Procfile: "Config",
  ".env": "Env",
  ".env.example": "Env",
  ".gitignore": "Config",
};

export function languageOf(path: string): string | null {
  const name = basename(path);
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith(".env")) return "Env";
  const ext = extname(name).toLowerCase();
  return BY_EXTENSION[ext] ?? null;
}

/** Source-like languages the model should read; data and markup are read only when relevant. */
const CODE_LANGUAGES = new Set([
  "TypeScript", "JavaScript", "Vue", "Svelte", "Astro", "Python", "Ruby", "Go", "Rust", "Java", "Kotlin",
  "Scala", "C#", "F#", "PHP", "Swift", "Objective-C", "Dart", "Elixir", "Erlang", "C", "C++", "Lua", "Shell",
  "PowerShell", "SQL", "Terraform", "Prisma", "GraphQL", "Docker",
]);

export function isCodeLanguage(language: string | null): boolean {
  return language !== null && CODE_LANGUAGES.has(language);
}

const CONFIG_LANGUAGES = new Set(["JSON", "YAML", "TOML", "Env", "Config", "Make", "XML"]);

export function isConfigLanguage(language: string | null): boolean {
  return language !== null && CONFIG_LANGUAGES.has(language);
}
