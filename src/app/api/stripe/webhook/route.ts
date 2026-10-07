import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleDisputeClosed, handleDisputeCreated, handlePaymentFailed, handlePaymentSucceeded, verifyStripeSignature } from "@/lib/stripe/payments";

type Handler = (object: never, admin: ReturnType<typeof createAdminClient>, eventId: string) => Promise<Record<string, unknown>>;

/** The Stripe events this endpoint handles; set the same list on the endpoint in Stripe. */
const HANDLERS: Record<string, Handler> = {
  "payment_intent.succeeded": handlePaymentSucceeded,
  "payment_intent.payment_failed": handlePaymentFailed,
  "charge.dispute.created": handleDisputeCreated,
  "charge.dispute.closed": handleDisputeClosed,
};

/**
 * Stripe webhook for the Pique Stripe account (STRIPE_WEBHOOK_SECRET is the endpoint's
 * signing secret). Every request must carry a valid Stripe signature. Other event types
 * are acknowledged and ignored. Answering 500 makes Stripe retry the event.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  const event = JSON.parse(raw) as { id: string; type: string; data: { object: never } };
  const handler = HANDLERS[event.type];
  if (!handler) return NextResponse.json({ ignored: event.type });
  const result = await handler(event.data.object, createAdminClient(), event.id);
  return NextResponse.json(result, { status: "error" in result ? 500 : 200 });
}
