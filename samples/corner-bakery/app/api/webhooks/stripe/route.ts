import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { sendConfirmation } from "../../../../lib/email";

// Stripe calls this when a payment settles. Marks the order paid and sends the confirmation.
export async function POST(request: Request) {
  const event = await request.json();
  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    const { data: order } = await supabase.from("orders").update({ status: "paid" }).eq("payment_intent", intent.id).select("id, user_id").single();
    if (order) {
      const { data: customer } = await supabase.from("customers").select("email").eq("id", order.user_id).single();
      if (customer) await sendConfirmation(customer.email, order.id);
    }
  }
  return NextResponse.json({ received: true });
}
