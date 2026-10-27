# Corner Bakery

Online ordering for a neighbourhood bakery. Customers browse the menu, add items to a basket and pay with a card. Staff see incoming orders on a dashboard. A morning cron picks the day's specials, and Stripe calls a webhook when a payment settles.

This is the sample app birdsI's demo maps. It is a small Next.js app with a Supabase database and Stripe payments, and it has a few problems left in on purpose, the kind a real app picks up over a year:

- The Stripe webhook at `app/api/webhooks/stripe/route.ts` never checks who sent the request, so a forged event could mark an order paid. `STRIPE_WEBHOOK_SECRET` is declared and never read.
- The daily cron at `app/api/cron/daily-specials/route.ts` runs without checking `CRON_SECRET`, so anyone who finds the address can run it.
- `RESEND_API_KEY` is declared in `.env.example` and nothing reads it, and `lodash` is listed in `package.json` and nothing imports it.
- `lib/auth.ts` falls back to a secret written in the code when `JWT_SECRET` is not set.
- `supabase/verify.sql` names what the two migrations create, so birdsI can tell which of them a connected database still owes.

Map it with `npx birdsi` from this folder, or read its cockpit on a birdsI deployment's demo page.

## Setup

```
npm install
cp .env.example .env.local
npm run dev
```
