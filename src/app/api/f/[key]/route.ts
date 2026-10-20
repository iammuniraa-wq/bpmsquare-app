import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { clientIp, hashIp, uaFamily } from "@/lib/marketing/forms/guards";
import { handleSubmission } from "@/lib/marketing/forms/submit";

// The public form submit. No session: the form's public key in the URL is the credential and
// the tenant is the one on that form's row. The body is read as TEXT so the size cap is
// enforced before any JSON is parsed; nothing in it is ever treated as a tenant or record id.
// Answers 404 for an unknown key, a draft form, or a workspace without the marketing_forms flag.
//
// POST /api/f/[key]  { name?, company?, email, phone?, message?, custom1..3?, consent?, rt, company_website (trap) }
//   -> 200 { ok: true, after: { kind: "message", message } | { kind: "redirect", url } }
//   -> 4xx/5xx { ok: false, error, fields? }

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 64_000) return NextResponse.json({ ok: false, error: "That is too much to send in one go." }, { status: 413 });
  const rawBody = (await req.text().catch(() => "")).slice(0, 64_000);
  const res = await handleSubmission(createAdminSupabase(), {
    key, rawBody, ipHash: hashIp(clientIp(req.headers)), uaFamily: uaFamily(req.headers.get("user-agent")),
  });
  return NextResponse.json(res.body, { status: res.status, headers: { "Cache-Control": "no-store" } });
}
