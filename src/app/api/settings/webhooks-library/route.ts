import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, needsUpdate, fail } from "./_guard";
import { createWebhook, listLibrary } from "@/lib/webhooks/library";
import { logChange } from "@/lib/changeLog";

// GET  -> { webhooks, recordButtons: { accounts }, objects, needsDatabaseUpdate, bundle }
// POST { kind, name, url, method?, object_type?, object_types?, headers?: [{ name, value }], payload_mode?, template?,
//        allow_personal_data?, timeout_ms?, button_on? } -> 201 { webhook, signing_secret }
//   422 { error, errors: [{ field, message }] }.
// The signing secret is returned ONCE, here; every later read says "set".
// Admin only, and only in a workspace with the webhooks_library flag (else 404). Without the migration (0202) the answer
// is { needsDatabaseUpdate: true, bundle } with status 200.
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  const r = await listLibrary(g.ctx.admin, g.ctx.tenantId);
  if (!r.ok) return r.pending ? needsUpdate({ webhooks: [], recordButtons: { accounts: null }, objects: [] }) : fail(r.status, r.error ?? "Could not read the webhooks.");
  return NextResponse.json({ ...r.value, needsDatabaseUpdate: false });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const r = await createWebhook(g.ctx.admin, g.ctx.tenantId, g.ctx.userId, await jsonBody(req));
  if (!r.ok) return r.pending ? needsUpdate() : fail(r.status, r.error ?? "Could not save.", { errors: r.errors ?? [] });
  await logChange(g.ctx.supabase, {
    tenantId: g.ctx.tenantId, objectType: "webhooks", objectId: r.value.webhook.id, objectLabel: r.value.webhook.name, action: "create",
    actorId: g.ctx.userId, actorEmail: g.ctx.email,
    changes: [{ field: "kind", from: null, to: r.value.webhook.kind }, { field: "url", from: null, to: r.value.webhook.url }],
  });
  return NextResponse.json({ webhook: r.value.webhook, signing_secret: r.value.secret }, { status: 201 });
}
