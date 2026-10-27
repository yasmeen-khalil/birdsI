import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "../../../lib/supabase";
import { readSession } from "../../../lib/auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

export async function POST(request: Request) {
  const session = readSession(request.headers.get("cookie")?.match(/session=([^;]+)/)?.[1]);
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const body = await request.json();

  const intent = await stripe.paymentIntents.create({
    amount: body.totalCents,
    currency: "usd",
    metadata: { userId: session.userId },
  });

  await supabase.from("orders").insert({
    user_id: session.userId,
    items: body.items,
    total_cents: body.totalCents,
    status: "paid",
    payment_intent: intent.id,
  });

  return NextResponse.json({ clientSecret: intent.client_secret });
}
