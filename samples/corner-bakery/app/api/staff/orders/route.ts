import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";

// Staff dashboard feed. The dashboard page only shows the link to staff.
export async function GET() {
  const { data } = await supabase.from("orders").select("*, customers(email, phone)").order("created_at", { ascending: false });
  return NextResponse.json({ orders: data ?? [] });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  await supabase.from("orders").update({ status: body.status }).eq("id", body.id);
  return NextResponse.json({ ok: true });
}
