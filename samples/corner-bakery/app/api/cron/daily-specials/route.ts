import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";

// Runs every morning (vercel.json): picks three items as the day's specials.
export async function GET() {
  const { data: items } = await supabase.from("menu_items").select("id").limit(50);
  const picked = (items ?? []).sort(() => Math.random() - 0.5).slice(0, 3).map((i) => i.id);
  await supabase.from("menu_items").update({ special: false }).neq("id", 0);
  if (picked.length > 0) await supabase.from("menu_items").update({ special: true }).in("id", picked);
  return NextResponse.json({ specials: picked });
}
