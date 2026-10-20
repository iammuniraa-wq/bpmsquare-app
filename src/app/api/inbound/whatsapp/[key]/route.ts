import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { handleInbound } from "@/lib/marketing/whatsapp/inbound";

// Inbound WhatsApp: replies, STOP / START and delivery status. No session: the credential is the provider's
// signature, checked over the raw body before it is parsed. The tenant comes ONLY from the stored identity row
// that [key] names (0186), never from the body. A workspace without the module, an unknown key and a disabled
// number all answer 404. Always 200 for a verified request we choose not to act on.
//
// Set this URL (https://<the workspace's own domain>/api/inbound/whatsapp/<key>) in the provider's console; the
// key and the signing secret are on Marketing, WhatsApp, Number and messages.

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const rawBody = await req.text();
  const r = await handleInbound(createAdminSupabase(), { key, headers: req.headers, rawBody });
  return NextResponse.json(r.body, { status: r.status });
}
