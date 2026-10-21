import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, needsUpdate, fail, UUID_RE } from "../../_guard";
import { getWebhookRow } from "@/lib/webhooks/library";
import { fireWebhook } from "@/lib/webhooks/sender";

export const maxDuration = 120;

// POST { object_id } -> { ok, status, durationMs, request, response: { status, body }, messageId, headline, fix }
// Trigger "test": really sent (a demo workspace records "redirected" instead), recorded in the Monitor, and it never moves
// the failure counter. An Event webhook needs no record: the test sends a ping.
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
  const r = await fireWebhook(g.ctx.admin, {
    tenantId: g.ctx.tenantId, webhookId: id, objectType: isEvent ? "webhooks" : row.object_type ?? "accounts", objectId: isEvent ? id : (body.object_id as string),
    trigger: "test", event: isEvent ? "webhook.test" : undefined, userId: g.ctx.userId,
  });
  if (r.needsDatabaseUpdate) return needsUpdate();
  return NextResponse.json({
    ok: r.ok, status: r.status, durationMs: r.durationMs, request: r.request ?? null, response: r.response ?? null,
    messageId: r.messageId, headline: r.headline, fix: r.fix,
  });
}
