/**
 * birdsI's checked limits list: per vendor, what each plan includes, what
 * ends it and what comes next, read by a person from the vendor's own
 * pricing page on the date given, with the page and the words it rests on.
 * It replaces the pricing pages a model used to read every week (removed in
 * v3: a wrong limit makes a wrong alert). Re-check a vendor when its page
 * changes, and change the date with the numbers.
 */
export interface LimitSource {
  url: string;
  /** The words on the page the number rests on. */
  quote: string;
}

export interface TierLimit {
  /** Matches the metric a connector reads, so an alert can compare usage with it. */
  metric: string;
  label: string;
  amount: number;
  unit: string;
  source: LimitSource;
}

export interface TierCondition {
  /** Stable id: "pauses", "non_commercial". */
  id: string;
  /** What the plan does on its own, in a few words. */
  text: string;
  source: LimitSource;
}

export interface PlanTier {
  name: string;
  /** Plan names as vendor APIs spell them ("hobby", "free"), matched exactly, never by substring. */
  aliases: string[];
  price: string;
  /** What the plan gives, in one line. */
  summary: string;
  limits: TierLimit[];
  conditions: TierCondition[];
  /** What ends the plan or brings the next bill. */
  endsWhen: string;
}

export interface VendorLimits {
  slug: string;
  name: string;
  /** The date a person last read the pricing page and checked every number below. */
  verifiedOn: string;
  pricingUrl: string;
  tiers: PlanTier[];
  /** The next price after the entry plan, in one line. */
  nextPrice: string;
  notes?: string;
}

const CHECKED = "2026-10-18";

const src = (url: string, quote: string): LimitSource => ({ url, quote });

const VERCEL = "https://vercel.com/pricing";
const VERCEL_HOBBY = "https://vercel.com/docs/plans/hobby";
const VERCEL_CRON = "https://vercel.com/docs/cron-jobs/usage-and-pricing";
const SUPABASE = "https://supabase.com/pricing";
const ONESIGNAL = "https://onesignal.com/pricing";
const ONESIGNAL_FAQ = "https://documentation.onesignal.com/docs/en/billing-faq";

export const VENDOR_LIMITS: readonly VendorLimits[] = [
  {
    slug: "vercel",
    name: "Vercel",
    verifiedOn: CHECKED,
    pricingUrl: VERCEL,
    tiers: [
      {
        name: "Hobby",
        aliases: ["hobby", "free"],
        price: "$0 a month",
        summary: "Personal, non-commercial use: 1M function invocations, 4 CPU-hours, 100 GB fast data transfer a month, crons at most once a day.",
        limits: [
          { metric: "function_invocations_month", label: "Function invocations a month", amount: 1_000_000, unit: "invocations", source: src(VERCEL, "1M / month included") },
          { metric: "active_cpu_hours_month", label: "Active CPU a month", amount: 4, unit: "hours", source: src(VERCEL, "4 hours / month included") },
          { metric: "fast_data_transfer_gb_month", label: "Fast data transfer a month", amount: 100, unit: "GB", source: src(VERCEL, "100 GB / month included") },
          { metric: "deployments_day", label: "Deployments a day", amount: 100, unit: "deployments", source: src("https://vercel.com/docs/limits", "Deployments per day | 100") },
          { metric: "cron_runs_per_day", label: "Runs a day for each cron", amount: 1, unit: "run", source: src(VERCEL_CRON, "Hobby accounts are limited to cron jobs that run once per day. Cron expressions that would run more frequently will fail during deployment.") },
        ],
        conditions: [
          { id: "non_commercial", text: "for personal, non-commercial use only", source: src(VERCEL, "Our Hobby plan is for personal, non-commercial use.") },
          { id: "hard_caps", text: "a feature that reaches its limit waits 30 days", source: src(VERCEL_HOBBY, "if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again.") },
        ],
        endsWhen: "Commercial use, or reaching a cap: the feature then waits for the next 30 days.",
      },
      {
        name: "Pro",
        aliases: ["pro"],
        price: "$20 a month, one deploying seat, $20 of usage credit",
        summary: "$20 of usage credit a month (it does not roll over), crons as often as once a minute, extra deploying seats $20 a month each.",
        limits: [
          { metric: "usage_credit_usd_month", label: "Usage credit a month", amount: 20, unit: "USD", source: src(VERCEL, "$20 of included usage credit") },
          { metric: "cron_runs_per_day", label: "Runs a day for each cron", amount: 1440, unit: "runs", source: src(VERCEL_CRON, "Pro 100 cron jobs Once per minute Per-minute") },
        ],
        conditions: [],
        endsWhen: "Usage past the $20 credit is billed on demand: builds, function time, transfer.",
      },
    ],
    nextPrice: "Pro $20 a month, then usage past the credit (Active CPU from $0.128 an hour, builds $0.0035 per CPU minute on Elastic machines).",
  },
  {
    slug: "supabase",
    name: "Supabase",
    verifiedOn: CHECKED,
    pricingUrl: SUPABASE,
    tiers: [
      {
        name: "Free",
        aliases: ["free"],
        price: "$0 a month",
        summary: "500 MB database, 1 GB file storage, 5 GB egress, 50,000 monthly active users, 2 active projects, paused after a week without traffic.",
        limits: [
          { metric: "db_size_mb", label: "Database size", amount: 500, unit: "MB", source: src(SUPABASE, "500 MB database size") },
          { metric: "storage_gb", label: "File storage", amount: 1, unit: "GB", source: src(SUPABASE, "1 GB file storage") },
          { metric: "egress_gb", label: "Egress a month", amount: 5, unit: "GB", source: src(SUPABASE, "5 GB egress") },
          { metric: "mau", label: "Monthly active users", amount: 50_000, unit: "users", source: src(SUPABASE, "50,000 monthly active users") },
          { metric: "active_projects", label: "Active projects", amount: 2, unit: "projects", source: src(SUPABASE, "Limit of 2 active projects.") },
        ],
        conditions: [{ id: "pauses", text: "projects pause after a week without traffic", source: src(SUPABASE, "Free projects are paused after 1 week of inactivity.") }],
        endsWhen: "Going past a quota: Supabase notifies you, then restricts the service.",
      },
      {
        name: "Pro",
        aliases: ["pro"],
        price: "From $25 a month, the first project included, more from $10 a month",
        summary: "8 GB disk per project, 100 GB file storage, 250 GB egress, 100,000 monthly active users, $10 of compute credit, never paused, a spend cap on by default.",
        limits: [
          { metric: "db_size_mb", label: "Disk per project", amount: 8192, unit: "MB", source: src(SUPABASE, "8 GB disk size per project then $0.125 per GB") },
          { metric: "storage_gb", label: "File storage", amount: 100, unit: "GB", source: src(SUPABASE, "100 GB file storage then $0.0213 per GB") },
          { metric: "egress_gb", label: "Egress a month", amount: 250, unit: "GB", source: src(SUPABASE, "250 GB egress then $0.09 per GB") },
          { metric: "mau", label: "Monthly active users", amount: 100_000, unit: "users", source: src(SUPABASE, "100,000 monthly active users then $0.00325 per MAU") },
        ],
        conditions: [],
        endsWhen: "Past the included quotas, billed per unit unless the spend cap stops it.",
      },
    ],
    nextPrice: "Pro from $25 a month.",
  },
  {
    slug: "clerk",
    name: "Clerk",
    verifiedOn: CHECKED,
    pricingUrl: "https://clerk.com/pricing",
    tiers: [
      {
        name: "Hobby",
        aliases: ["hobby", "free"],
        price: "Free",
        summary: "50,000 monthly retained users per app, up to 3 dashboard seats.",
        limits: [{ metric: "mru", label: "Monthly retained users", amount: 50_000, unit: "users", source: src("https://clerk.com/pricing", "50,000 MRU limit per app") }],
        conditions: [],
        endsWhen: "Past 50,000 retained users a month Pro is required, after a one-month grace period.",
      },
      {
        name: "Pro",
        aliases: ["pro"],
        price: "$25 a month, or $20 a month billed yearly",
        summary: "50,000 retained users per app included, then $0.02 each up to 100,000.",
        limits: [],
        conditions: [],
        endsWhen: "Each retained user past 50,000 is billed: $0.02 to 100,000, then less.",
      },
    ],
    nextPrice: "Pro $25 a month ($20 billed yearly).",
  },
  {
    slug: "resend",
    name: "Resend",
    verifiedOn: CHECKED,
    pricingUrl: "https://resend.com/pricing",
    tiers: [
      {
        name: "Free",
        aliases: ["free"],
        price: "$0 a month",
        summary: "3,000 emails a month, 100 a day, 3 domains, 30 days of data.",
        limits: [
          { metric: "emails_month", label: "Emails a month", amount: 3000, unit: "emails", source: src("https://resend.com/pricing", "3,000 emails / mo") },
          { metric: "emails_day", label: "Emails a day", amount: 100, unit: "emails", source: src("https://resend.com/pricing", "100 emails a day") },
          { metric: "domains", label: "Sending domains", amount: 3, unit: "domains", source: src("https://resend.com/pricing", "3 domains") },
        ],
        conditions: [],
        endsWhen: "Past a limit without pay-as-you-go, Resend notifies you and offers a higher plan.",
      },
      {
        name: "Pro",
        aliases: ["pro"],
        price: "$20 a month",
        summary: "50,000 emails a month, no daily limit, 10 domains, extra emails $0.90 per 1,000.",
        limits: [
          { metric: "emails_month", label: "Emails a month", amount: 50_000, unit: "emails", source: src("https://resend.com/pricing", "50,000 emails / mo") },
          { metric: "domains", label: "Sending domains", amount: 10, unit: "domains", source: src("https://resend.com/pricing", "10 domains") },
        ],
        conditions: [],
        endsWhen: "Past 50,000 a month, extra emails at $0.90 per 1,000, or Scale at $90 a month.",
      },
    ],
    nextPrice: "Pro $20 a month for 50,000 emails.",
  },
  {
    slug: "onesignal",
    name: "OneSignal",
    verifiedOn: CHECKED,
    pricingUrl: ONESIGNAL,
    tiers: [
      {
        name: "Free",
        aliases: ["free"],
        price: "$0 a month",
        summary: "Mobile push only for organizations under 1,000 monthly active users (since 1 October 2026 for existing accounts), web push to at most 10,000 subscribers per send, 10,000 emails a month.",
        limits: [
          { metric: "mobile_mau", label: "Mobile monthly active users", amount: 1000, unit: "users", source: src(ONESIGNAL_FAQ, "you must have fewer than 1,000 monthly active users (MAU) to send mobile push and in-app messages. These changes take effect for new customers on September 1, 2026 and existing customers on October 1, 2026.") },
          { metric: "web_push_per_send", label: "Web push subscribers per send", amount: 10_000, unit: "subscribers", source: src(ONESIGNAL, "Max 10,000 subscribers per send") },
          { metric: "email_sends_month", label: "Email sends a month", amount: 10_000, unit: "sends", source: src(ONESIGNAL, "10,000 sends / month") },
        ],
        conditions: [{ id: "mobile_mau_cap", text: "mobile push stops at 1,000 monthly active users", source: src(ONESIGNAL_FAQ, "Mobile push and in-app messages stop sending until you upgrade. Other channels continue to work") }],
        endsWhen: "1,000 mobile monthly active users: mobile push and in-app messages stop until you upgrade.",
      },
      {
        name: "Growth",
        aliases: ["growth"],
        price: "From $19 a month",
        summary: "Mobile push at $0.012 per monthly active user, web push at $0.004 per subscriber, 20,000 email sends a month.",
        limits: [],
        conditions: [],
        endsWhen: "Billed per monthly active user and per web push subscriber.",
      },
    ],
    nextPrice: "Growth from $19 a month, plus $0.012 per mobile monthly active user.",
    notes: "OneSignal's older free plan counted 10,000 subscribers. Since 1 October 2026 the free plan sends mobile push only under 1,000 mobile monthly active users.",
  },
  {
    slug: "revenuecat",
    name: "RevenueCat",
    verifiedOn: CHECKED,
    pricingUrl: "https://www.revenuecat.com/pricing/",
    tiers: [
      {
        name: "Pro",
        aliases: ["pro", "free", "starter"],
        price: "Free up to $2,500 of monthly tracked revenue",
        summary: "Nothing to pay up to $2,500 of monthly tracked revenue, counted before the store's cut, then 1% of all of it that month.",
        limits: [{ metric: "mtr_usd_month", label: "Monthly tracked revenue", amount: 2500, unit: "USD", source: src("https://www.revenuecat.com/pricing/", "Pay nothing for up to $2,500 in monthly tracked revenue.") }],
        conditions: [],
        endsWhen: "$2,500 of tracked revenue in a month: 1% of all of it is charged.",
      },
    ],
    nextPrice: "1% of monthly tracked revenue once it reaches $2,500.",
  },
  {
    slug: "stripe",
    name: "Stripe",
    verifiedOn: CHECKED,
    pricingUrl: "https://stripe.com/pricing",
    tiers: [
      {
        name: "Standard",
        aliases: ["standard", "pay as you go"],
        price: "2.9% + 30 cents per successful domestic card payment",
        summary: "No monthly fee. Plus 1.5% for international cards, 1% for currency conversion, $15 for each dispute.",
        limits: [],
        conditions: [],
        endsWhen: "Never: every payment carries the fee from the first one.",
      },
    ],
    nextPrice: "Per payment, no plan.",
  },
  {
    slug: "anthropic",
    name: "Anthropic (Claude)",
    verifiedOn: CHECKED,
    pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
    tiers: [
      {
        name: "Pay as you go",
        aliases: ["pay as you go", "usage"],
        price: "Per token: Haiku 4.5 $1 in and $5 out, Sonnet 5.5 $2 and $10, Opus 5.5 $4 and $20, per million",
        summary: "Billed on actual monthly usage. Each usage tier has a monthly spend cap ($500 on Start), and the API pauses at it until the next month.",
        limits: [],
        conditions: [{ id: "spend_cap_pause", text: "the API pauses at the tier's monthly spend cap", source: src("https://platform.claude.com/docs/en/api/rate-limits", "Once you reach your tier's spend cap, API usage pauses until 00:00 UTC on the first day of the next month.") }],
        endsWhen: "Every call is billed. The tier's monthly spend cap pauses the API until the next month.",
      },
    ],
    nextPrice: "Per token, no plan.",
  },
  {
    slug: "google-ai",
    name: "Google AI (Gemini)",
    verifiedOn: CHECKED,
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    tiers: [
      {
        name: "Free",
        aliases: ["free", "unpaid"],
        price: "$0",
        summary: "Limited models and rate limits, and Google may use the prompts and answers to improve its products.",
        limits: [],
        conditions: [{ id: "prompts_used", text: "Google may use prompts to improve its products, and people may read them", source: src("https://ai.google.dev/gemini-api/terms", "human reviewers may read, annotate, and process your API input and output") }],
        endsWhen: "A key from a Cloud project with an active billing account moves to the paid tier.",
      },
      {
        name: "Paid",
        aliases: ["paid", "tier 1"],
        price: "Per token, by model",
        summary: "Higher rate limits, prompts not used to improve Google's products.",
        limits: [],
        conditions: [],
        endsWhen: "Billed per token.",
      },
    ],
    nextPrice: "Per token on a billed Cloud project.",
  },
  {
    slug: "supadata",
    name: "Supadata",
    verifiedOn: CHECKED,
    pricingUrl: "https://supadata.ai/pricing",
    tiers: [
      {
        name: "Free",
        aliases: ["free"],
        price: "$0",
        summary: "100 credits a month, one request a second, credits do not roll over.",
        limits: [{ metric: "credits_month", label: "Credits a month", amount: 100, unit: "credits", source: src("https://supadata.ai/pricing", "100 requests/month, no credit card") }],
        conditions: [],
        endsWhen: "At 100 credits, requests stop until the next month, an upgrade or Auto Recharge.",
      },
    ],
    nextPrice: "Basic $5 a month billed yearly for 300 credits, or Pro $17 a month for 3,000.",
  },
  {
    slug: "tavily",
    name: "Tavily",
    verifiedOn: CHECKED,
    pricingUrl: "https://www.tavily.com/pricing",
    tiers: [
      {
        name: "Researcher",
        aliases: ["researcher", "free"],
        price: "Free",
        summary: "1,000 API credits a month, reset on the first of the month.",
        limits: [{ metric: "credits_month", label: "Credits a month", amount: 1000, unit: "credits", source: src("https://www.tavily.com/pricing", "1,000 API credits / month") }],
        conditions: [],
        endsWhen: "At 1,000 credits, requests stop until the reset or an upgrade.",
      },
    ],
    nextPrice: "Pay as you go at $0.008 a credit, or Project $30 a month for 4,000.",
  },
  {
    slug: "github",
    name: "GitHub",
    verifiedOn: CHECKED,
    pricingUrl: "https://github.com/pricing",
    tiers: [
      {
        name: "Free",
        aliases: ["free"],
        price: "$0",
        summary: "2,000 Actions minutes a month for private repositories (public ones are free), 500 MB of Packages storage.",
        limits: [{ metric: "actions_minutes_month", label: "Actions minutes a month, private repositories", amount: 2000, unit: "minutes", source: src("https://github.com/pricing", "2,000 CI/CD minutes/month Free for public repositories") }],
        conditions: [],
        endsWhen: "Without a payment method, Actions stop when the minutes run out.",
      },
    ],
    nextPrice: "Linux minutes at $0.006 each, or Team $4 a user a month with 3,000 minutes.",
  },
  {
    slug: "railway",
    name: "Railway",
    verifiedOn: CHECKED,
    pricingUrl: "https://railway.com/pricing",
    tiers: [
      {
        name: "Hobby",
        aliases: ["hobby"],
        price: "$5 minimum usage a month",
        summary: "$5 of usage credit a month, which does not accumulate.",
        limits: [{ metric: "usage_credit_usd_month", label: "Usage credit a month", amount: 5, unit: "USD", source: src("https://railway.com/pricing", "Includes $5 of monthly usage credits") }],
        conditions: [],
        endsWhen: "Usage past $5 in a month is charged in full.",
      },
    ],
    nextPrice: "Pro $20 minimum usage a month.",
  },
  {
    slug: "clarity",
    name: "Microsoft Clarity",
    verifiedOn: CHECKED,
    pricingUrl: "https://clarity.microsoft.com",
    tiers: [
      {
        name: "Free",
        aliases: ["free"],
        price: "Free, no paid plan",
        summary: "Up to 100,000 recorded sessions per project a day, recordings kept 30 days.",
        limits: [{ metric: "sessions_day", label: "Recorded sessions a day", amount: 100_000, unit: "sessions", source: src("https://learn.microsoft.com/en-us/clarity/faq", "Clarity records up to 100,000 sessions per project per day.") }],
        conditions: [],
        endsWhen: "Nothing: there is no paid plan.",
      },
    ],
    nextPrice: "None.",
  },
  {
    slug: "metalpriceapi",
    name: "MetalpriceAPI",
    verifiedOn: CHECKED,
    pricingUrl: "https://metalpriceapi.com/pricing",
    tiers: [
      {
        name: "Free",
        aliases: ["free"],
        price: "$0 a month",
        summary: "100 requests a month, prices updated daily.",
        limits: [{ metric: "requests_month", label: "Requests a month", amount: 100, unit: "requests", source: src("https://metalpriceapi.com/pricing", "100 Requests / month") }],
        conditions: [],
        endsWhen: "100 requests a month. What happens past it is not on the page.",
      },
      {
        name: "Essential",
        aliases: ["essential"],
        price: "$5 a month billed yearly, $7 billed monthly",
        summary: "1,000 requests a month, prices every 30 minutes.",
        limits: [{ metric: "requests_month", label: "Requests a month", amount: 1000, unit: "requests", source: src("https://metalpriceapi.com/pricing", "1,000 Requests / month") }],
        conditions: [],
        endsWhen: "1,000 requests a month.",
      },
    ],
    nextPrice: "Essential $5 a month billed yearly.",
  },
  {
    slug: "apple",
    name: "Apple Developer Program",
    verifiedOn: CHECKED,
    pricingUrl: "https://developer.apple.com/programs/",
    tiers: [
      {
        name: "Membership",
        aliases: ["membership", "individual", "organization"],
        price: "$99 a year",
        summary: "Publishing on the App Store, TestFlight, Sign in with Apple.",
        limits: [],
        conditions: [{ id: "yearly_renewal", text: "the membership renews every year", source: src("https://developer.apple.com/programs/", "$99 annual membership") }],
        endsWhen: "The yearly renewal.",
      },
    ],
    nextPrice: "$99 a year.",
  },
];


export const LIMITS_BY_SLUG = new Map(VENDOR_LIMITS.map((v) => [v.slug, v]));

/** The tier a plan name refers to: an exact match on the name or an alias, case and spacing aside. */
export function tierFor(limits: VendorLimits, plan: string): PlanTier | null {
  const wanted = normalise(plan);
  if (!wanted) return null;
  return limits.tiers.find((t) => normalise(t.name) === wanted || t.aliases.some((a) => normalise(a) === wanted)) ?? null;
}

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+plan$/, "").replace(/\s+/g, " ");
}

/** The checked limit for a metric on the plan an account is on, when the list has one. */
export function checkedLimit(slug: string, plan: string | null | undefined, metric: string): TierLimit | null {
  const limits = LIMITS_BY_SLUG.get(slug);
  if (!limits || !plan) return null;
  return tierFor(limits, plan)?.limits.find((l) => l.metric === metric) ?? null;
}
