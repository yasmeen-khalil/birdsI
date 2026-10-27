import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("q") ?? "";
  const { data } = await supabase.rpc("search_menu", { query: `%${search}%` });
  return NextResponse.json({ items: data ?? [] }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
