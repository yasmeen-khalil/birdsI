import { en, type Copy } from "./en";

/**
 * The UI is English only for now. The structure is here so a second
 * language is a new file plus a locale switch, and the guard test keeps
 * every dictionary complete and free of characters the product style bans.
 */
export const locales = { en } as const satisfies Record<string, Copy>;
export type Locale = keyof typeof locales;
export const defaultLocale: Locale = "en";

export function copy(locale: Locale = defaultLocale): Copy {
  return locales[locale];
}

export { en };
export type { Copy };
