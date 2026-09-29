# Corner Bakery

Online ordering for a neighbourhood bakery. Customers browse the menu, add items to a basket and pay with a card. Staff see incoming orders on a dashboard.

## Features

- Menu with daily specials
- Basket and checkout with Stripe
- Order history for signed-in customers
- Staff dashboard, protected by a staff role
- Email confirmation for every order

## Setup

```
npm install
cp .env.example .env.local
npm run dev
```

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `STRIPE_SECRET_KEY` and `JWT_SECRET` in `.env.local`.
