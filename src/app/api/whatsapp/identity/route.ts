import { NextResponse, type NextRequest } from "next/server";
import { moduleAccess, moduleErrorResponse, pendingMessage } from "@/lib/marketing/moduleAccess";
import { loadIdentity, saveIdentity, viewOf } from "@/lib/marketing/whatsapp/identity";
import { PROVIDERS } from "@/lib/marketing/whatsapp/provider";
import { WHATSAPP_SPEC } from "@/lib/marketing/whatsapp/server";
import { logChange } from "@/lib/changeLog";

// The workspace's WhatsApp number and provider. ADMIN ONLY on both verbs: credentials never reach a non-admin.
//
// GET -> { identity: {provider, providerLabel, status, maskedNumber, webhookKey, hasWebhookSecret, filled} | null, providers }
//        The number comes back masked; no credential value is ever returned.
// PUT { provider?, display_number?, credentials?, status?, rotate_secret? }
//        A blank credential means "unchanged". The webhook secret is returned ONCE, on the call that made it.

const pending = () => NextResponse.json({ error: pendingMessage(WHATSAPP_SPEC), pending_migration: true }, { status: 503 });
const forbidden = () => NextResponse.json({ error: "Only an admin can change the WhatsApp number." }, { status: 403 });

export async function GET() {
  try {
    const ctx = await moduleAccess(WHATSAPP_SPEC, "view");
    if (ctx.role !== "admin") return forbidden();
    const { row, missing } = await loadIdentity(ctx.admin, ctx.tenantId);
    if (missing) return pending();
    return NextResponse.json({
      identity: row ? viewOf(row) : null,
      providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, fields: p.credentialFields })),
    });
  } catch (e) {
    return moduleErrorResponse(WHATSAPP_SPEC, e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await moduleAccess(WHATSAPP_SPEC, "edit");
    if (ctx.role !== "admin") return forbidden();
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return NextResponse.json({ error: "That could not be read." }, { status: 400 });
    const credentials: Record<string, string> = {};
    if (b.credentials && typeof b.credentials === "object") {
      for (const [k, v] of Object.entries(b.credentials as Record<string, unknown>)) if (typeof v === "string") credentials[k] = v;
    }
    const r = await saveIdentity(ctx.admin, ctx.tenantId, ctx.userId, {
      provider: typeof b.provider === "string" ? b.provider : undefined,
      displayNumber: typeof b.display_number === "string" ? b.display_number : undefined,
      credentials,
      status: b.status === "disabled" ? "disabled" : b.status === "active" ? "active" : undefined,
      rotateSecret: b.rotate_secret === true,
    });
    if (!r.ok) return r.missing ? pending() : NextResponse.json({ error: r.error }, { status: 422 });
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "whatsapp_identity", objectId: ctx.tenantId, objectLabel: "WhatsApp number",
      action: "update", actorId: ctx.userId, actorEmail: ctx.email,
      changes: [{ field: "whatsapp_identity", from: null, to: r.secret ? "number saved, new webhook secret made" : "number saved" }],
    });
    return NextResponse.json({ identity: r.view, secret: r.secret });
  } catch (e) {
    return moduleErrorResponse(WHATSAPP_SPEC, e);
  }
}
