import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handlePaymentSucceeded, verifyStripeSignature } from "@/lib/stripe/payments";

/**
 * Stripe webhook for the Pique Stripe account (endpoint set up in Stripe with the
 * payment_intent.succeeded event; STRIPE_WEBHOOK_SECRET is its signing secret).
 * Every request must carry a valid Stripe signature. Other event types are
 * acknowledged and ignored. Answering 500 makes Stripe retry the event.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  const event = JSON.parse(raw) as { id: string; type: string; data: { object: unknown } };
  if (event.type !== "payment_intent.succeeded") {
    return NextResponse.json({ ignored: event.type });
  }
  const result = await handlePaymentSucceeded(createAdminClient(), event.id, event.data.object as Parameters<typeof handlePaymentSucceeded>[2]);
  return NextResponse.json(result, { status: "error" in result ? 500 : 200 });
}
