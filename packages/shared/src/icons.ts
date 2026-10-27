import type { VendorCategory } from "./ops";

/** The order services are grouped in on the cockpit: what the app runs on first, then what it does. */
export const CATEGORY_ORDER: readonly VendorCategory[] = ["hosting", "database", "auth", "payments", "email", "messaging", "ai", "analytics", "monitoring", "storage", "search", "maps", "media", "other"];

export const VENDOR_CATEGORY_LABEL: Record<VendorCategory, string> = {
  hosting: "Hosting",
  database: "Database",
  auth: "Sign-in",
  payments: "Payments",
  email: "Email",
  ai: "AI",
  search: "Search",
  analytics: "Analytics",
  storage: "Storage",
  messaging: "Messaging",
  monitoring: "Monitoring",
  maps: "Maps",
  media: "Media",
  other: "Other",
};

/** Simple Icons names for the catalog's vendors. A vendor with none shows a letter tile. */
export const VENDOR_ICON_SLUGS: Record<string, string> = {
  supabase: "supabase",
  vercel: "vercel",
  clerk: "clerk",
  stripe: "stripe",
  resend: "resend",
  anthropic: "anthropic",
  openai: "openai",
  github: "github",
  sentry: "sentry",
  posthog: "posthog",
  onesignal: "onesignal",
  twilio: "twilio",
  sendgrid: "sendgrid",
  mailgun: "mailgun",
  cloudflare: "cloudflare",
  firebase: "firebase",
  planetscale: "planetscale",
  upstash: "upstash",
  railway: "railway",
  fly: "flydotio",
  render: "render",
  netlify: "netlify",
  algolia: "algolia",
  mapbox: "mapbox",
  "google-maps": "googlemaps",
  cloudinary: "cloudinary",
  "lemon-squeezy": "lemonsqueezy",
  paddle: "paddle",
  auth0: "auth0",
  intercom: "intercom",
  plausible: "plausibleanalytics",
  mixpanel: "mixpanel",
  elevenlabs: "elevenlabs",
  replicate: "replicate",
  expo: "expo",
  apple: "apple",
  "google-ai": "googlegemini",
  langsmith: "langchain",
  aws: "amazonwebservices",
};

/** The address of a vendor's logo, or null when none is known. */
export function iconUrlFor(slug: string): string | null {
  const name = VENDOR_ICON_SLUGS[slug];
  return name ? `https://cdn.simpleicons.org/${name}` : null;
}

/** Where an app's own icon is likely to be, from its live address: tried in order by the page. */
export function appIconCandidates(base: string | null): string[] {
  if (!base) return [];
  const root = base.replace(/\/+$/, "");
  return [`${root}/apple-touch-icon.png`, `${root}/icon.png`, `${root}/favicon.png`, `${root}/favicon.ico`];
}
