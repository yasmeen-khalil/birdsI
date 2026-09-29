import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { readSession } from "../../../lib/auth";

// Returns the orders for a customer.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const { data } = await supabase.from("orders").select("*").eq("user_id", userId);
  return NextResponse.json({ orders: data ?? [] });
}

export async function POST(request: Request) {
  const session = readSession(request.headers.get("cookie")?.match(/session=([^;]+)/)?.[1]);
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const body = await request.json();
  const { data, error } = await supabase
    .from("orders")
    .insert({ user_id: session.userId, items: body.items, total_cents: body.totalCents, status: "paid" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ order: data });
}
