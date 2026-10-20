import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { verifySvix } from "@/lib/mail/webhookSignature";
import { normaliseResendEvent } from "@/lib/marketing/resendEvents";
import { processDelivery } from "@/lib/marketing/deliveryEvents";

// Resend delivery events: delivered, bounced, complained, delivery delayed.
// No session: the credential is the provider's Svix signature, checked before the
// body is read. The tenant and the person come ONLY from the recipient row we stored
// when we sent the message (found by our own recipient_id tag), never from the body.
//
// Create the endpoint in Resend (Webhooks -> Add endpoint), URL
// https://<your app host>/api/webhooks/resend, events email.delivered,
// email.bounced, email.complained and email.delivery_delayed, then put its signing
// secret (whsec_...) in RESEND_WEBHOOK_SECRET. Without the secret every request is
// refused with 503 -- an unsigned request is never accepted.
//
// Always 200 for a verified event we choose not to act on (an event type we do not
// use, a message that is not ours), so the provider does not retry it forever.

export const runtime = "nodejs";
export const maxDuration = 30;

let warnedMissingSecret = false;

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? "";
  if (!secret) {
    if (!warnedMissingSecret) {
      console.error("[resend webhook] RESEND_WEBHOOK_SECRET is not set, so delivery events are being refused.");
      warnedMissingSecret = true;
    }
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  const raw = await req.text();
  if (raw.length > 1024 * 1024) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const svixId = req.headers.get("svix-id");
  const ok = verifySvix(secret, { id: svixId, timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, raw);
  if (!ok || !svixId) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }

  const delivery = normaliseResendEvent(body);
  if (!delivery) return NextResponse.json({ ok: true, ignored: true });

  try {
    const outcome = await processDelivery(createAdminSupabase(), delivery, svixId);
    // "unavailable" is ours to fix and the provider's retry may succeed; everything else is final.
    if (outcome.status === "unmatched" && outcome.reason === "unavailable") {
      return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, result: outcome.status });
  } catch (e) {
    console.error("[resend webhook] processing failed", e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
