import { NextResponse, type NextRequest } from "next/server";
import { guard, needsUpdate, fail, UUID_RE } from "../../_guard";
import { getWebhookRow } from "@/lib/webhooks/library";
import { MESSAGES_TABLE } from "@/lib/middleware/messages";
import { isSchemaPending } from "@/lib/marketing/pending";

// GET -> { items: [{ id, at, status, http_status, duration_ms, headline, monitorId }] }  the last 20.
// A Call webhook reads its Monitor rows (integration_messages by webhook_id); an Event webhook reads webhook_deliveries.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "Not found");
  const { row, pending } = await getWebhookRow(g.ctx.admin, g.ctx.tenantId, id);
  if (pending) return needsUpdate({ items: [] });
  if (!row) return fail(404, "Not found");

  if (row.kind === "event") {
    const { data } = await g.ctx.admin.from("webhook_deliveries").select("id, ok, status, error, duration_ms, event_count, created_at")
      .eq("tenant_id", g.ctx.tenantId).eq("webhook_id", id).order("created_at", { ascending: false }).limit(20);
    return NextResponse.json({
      items: ((data ?? []) as { id: string; ok: boolean; status: number | null; error: string | null; duration_ms: number | null; event_count: number; created_at: string }[]).map((d) => ({
        id: d.id, at: d.created_at, status: d.ok ? "ok" : "failed", http_status: d.status, duration_ms: d.duration_ms,
        headline: d.ok ? `Sent ${d.event_count} change${d.event_count === 1 ? "" : "s"}.` : d.error ?? "Failed", monitorId: null,
      })),
    });
  }

  const { data, error } = await g.ctx.admin.from(MESSAGES_TABLE).select("id, status, http_status, duration_ms, summary, created_at")
    .eq("tenant_id", g.ctx.tenantId).eq("webhook_id", id).order("created_at", { ascending: false }).limit(20);
  if (isSchemaPending(error)) return needsUpdate({ items: [] });
  return NextResponse.json({
    items: ((data ?? []) as { id: string; status: string; http_status: number | null; duration_ms: number | null; summary: { headline?: string } | null; created_at: string }[]).map((m) => ({
      id: m.id, at: m.created_at, status: m.status, http_status: m.http_status, duration_ms: m.duration_ms,
      headline: m.summary?.headline ?? "", monitorId: `integration:${m.id}`,
    })),
  });
}
