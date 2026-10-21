import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail, needsUpdate } from "../_guard";
import { MESSAGES_TABLE } from "@/lib/middleware/messages";
import { describeDispatch } from "@/lib/middleware/ops";
import { dispatchQuoteOutcome } from "@/lib/middleware/dispatch";
import { isSchemaPending } from "@/lib/marketing/pending";
import { OUTCOMES, type Outcome } from "@/lib/middleware/types";

// POST { message_id } -- retry a failed (or waiting) outbound quote message.
// Safe to repeat: the engine finds the ERP quote through the stored link and
// continues from where it stopped, so a second press never makes a twin.
// -> { ok, message, number?, link? }  or  { ok:false, headline, fix }
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ message_id?: string }>(req);
  const raw = String(body.message_id ?? "").replace(/^integration:/, "");
  if (!/^[0-9a-f-]{32,40}$/i.test(raw)) return fail(422, "Choose a message to retry.");
  const { data, error } = await g.ctx.admin.from(MESSAGES_TABLE).select("id, object_type, object_id, status, summary").eq("id", raw).eq("tenant_id", g.ctx.tenantId).maybeSingle();
  if (error) return isSchemaPending(error) ? needsUpdate() : fail(500, "Could not read the message.");
  const m = data as { object_type: string | null; object_id: string | null; status: string; summary: Record<string, unknown> | null } | null;
  if (!m) return fail(404, "Message not found.");
  if (m.object_type !== "standard_quotes" || !m.object_id) return fail(422, "Only a quote that did not go out can be retried. For a test, send another test.");
  if (m.status !== "failed" && m.status !== "pending") return NextResponse.json({ ok: true, message: "This one is already dealt with. Nothing to retry." });
  const outcome = m.summary?.outcome;
  if (!(OUTCOMES as readonly unknown[]).includes(outcome)) return fail(422, "This message does not say whether the quote was awarded or rejected.");
  const r = describeDispatch(await dispatchQuoteOutcome(g.ctx.admin, g.ctx.tenantId, m.object_id, { trigger: m.status === "pending" ? "send_now" : "retry", userId: g.ctx.userId, outcome: outcome as Outcome }));
  if (!r.ok && r.needsDatabaseUpdate) return needsUpdate();
  return NextResponse.json(r, { status: r.ok ? 200 : r.status });
}
