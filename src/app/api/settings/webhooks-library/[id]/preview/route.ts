import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, needsUpdate, fail, UUID_RE } from "../../_guard";
import { getWebhookRow } from "@/lib/webhooks/library";
import { previewWebhook } from "@/lib/webhooks/sender";

export const maxDuration = 60;

// POST { object_id } -> { request: { method, url, headers: [names], body } }  Nothing is sent or recorded; header values are never shown.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const { id } = await params;
  const body = await jsonBody<{ object_id?: string }>(req);
  if (!UUID_RE.test(id)) return fail(404, "Not found");
  const { row, pending } = await getWebhookRow(g.ctx.admin, g.ctx.tenantId, id);
  if (pending) return needsUpdate();
  if (!row) return fail(404, "Not found");
  const isEvent = row.kind === "event";
  if (!isEvent && (typeof body.object_id !== "string" || !UUID_RE.test(body.object_id))) return fail(422, "Choose a sample record.");
  const r = await previewWebhook(g.ctx.admin, { tenantId: g.ctx.tenantId, webhookId: id, objectType: isEvent ? "webhooks" : row.object_type ?? "accounts", objectId: isEvent ? id : (body.object_id as string) });
  if (!r.ok) return r.needsDatabaseUpdate ? needsUpdate() : fail(422, r.headline, { fix: r.fix });
  return NextResponse.json({ request: r.request });
}
