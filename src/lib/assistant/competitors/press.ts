import "server-only";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canEditWorkcenter, type PermissionSet } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import { actionsEnabled } from "@/lib/actions/registry";
import { claimCard, finishCard, usedResult } from "@/lib/actions/ledger";
import { verifyToken } from "@/lib/actions/token";
import { runVia } from "@/lib/actions/via";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { parseNewCompetitor } from "@/lib/tender/competitors/rules";
import { isUuid } from "../objects";
import { PROPOSE_ACT, hash8, structureOf } from "./tools";

// The press of the "add a competitor" card. Same order of checks as POST /api/ai/act, because it is the same kind of door:
//   1 the token proves this server showed this person this card, for this workspace, and has not expired; the tender is inside it
//   2 the flag, the Pipeline edit grant and the tender edition are checked now, not as they were when the card was shown
//   3 only the three fields the card offered are read, as plain text, and the competitors route checks them again
//   4 the card id is claimed once; a second press cannot add it twice
//   5 the competitors route itself runs, in-process, on the person's own session, so its tender gate, its duplicate and limit checks and
//     its Change History entry are exactly those of the Competitors tab (marked "via assistant")
// The assistant holds no database client for the write, and the workspace and the tender never come from the request body.

export type PressCtx = {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  /** Base for the in-process request to the route; only the path is used. */
  baseUrl: string;
  now?: number;
};

export type PressBody = { card_id?: unknown; token?: unknown; values?: unknown };
export type PressOutcome = { status: number; body: Record<string, unknown> };

const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): PressOutcome => ({ status, body: { ok: false, code, error, ...extra } });

const KEYS = new Set(["name", "country", "note"]);

export async function pressCompetitorCard(ctx: PressCtx, body: PressBody): Promise<PressOutcome> {
  const cardId = typeof body.card_id === "string" ? body.card_id : "";
  const verified = verifyToken(body.token, { tenantId: ctx.tenantId, userId: ctx.userId, cardId }, ctx.now);
  if (!verified.ok) {
    return verified.reason === "expired"
      ? refuse(410, "expired", "This card has expired. Ask me again and I will show a fresh one.")
      : refuse(403, "token", "This card was not issued to you in this workspace.");
  }
  const payload = verified.payload;
  const dealId = payload.act.startsWith(`${PROPOSE_ACT}:`) ? payload.act.slice(PROPOSE_ACT.length + 1) : "";
  if (!isUuid(dealId) || payload.h !== structureOf()) return refuse(409, "stale", "This card is out of date. Ask me again.");

  const used = await usedResult(ctx.admin, { cardId, tenantId: ctx.tenantId, userId: ctx.userId });
  if (used) return refuse(409, "already_done", "This card has already been used.", { result: used.result });

  const f = ctx.features;
  if (!actionsEnabled(f) || f.gcc_tender !== true || f.pipeline !== true || !canEditWorkcenter(ctx.perms, "pipeline")) {
    return refuse(403, "not_allowed", "You are not allowed to do that here.");
  }

  if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) return refuse(400, "values", "No values were sent.");
  const raw = body.values as Record<string, unknown>;
  const unknown = Object.keys(raw).filter((k) => !KEYS.has(k));
  if (unknown.length) return refuse(422, "unknown_field", "A field that is not on the card was sent.", { fields: unknown });
  const text = (v: unknown): string | null => (v === undefined || v === null ? "" : typeof v === "string" ? v : null);
  const [name, country, note] = [text(raw.name), text(raw.country), text(raw.note)];
  if (name === null || country === null || note === null) return refuse(422, "invalid", "Each field must be plain text.");
  const parsed = parseNewCompetitor({ name, country, notes: note });
  if (!parsed.ok) return refuse(422, "invalid", parsed.error);

  const opp = await loadOpportunity(ctx.admin, ctx.tenantId, dealId);
  if (!opp) return refuse(422, "ref", "That tender was not found in this workspace.");
  const route = `/api/opportunities/${dealId}/competitors`;
  const values = { name: parsed.value.name, country: parsed.value.country ?? "", note: parsed.value.notes ?? "" };
  const shown = {
    action: PROPOSE_ACT, object: "competitor", summary: payload.sm, deal: opp.ref ?? dealId,
    proposed_keys: Object.keys(payload.pv),
    edited: (Object.keys(values) as (keyof typeof values)[]).filter((k) => payload.pv[k] !== undefined && payload.pv[k] !== hash8(values[k])),
    values: { name: values.name, country: values.country || null, has_note: values.note !== "" },
  };

  const claim = await claimCard(ctx.admin, {
    cardId, tenantId: ctx.tenantId, userId: ctx.userId, kind: "create", actionKey: PROPOSE_ACT, route, card: shown, params: shown.values,
  });
  if (claim.state === "done") return refuse(409, "already_done", "This card has already been used.", { result: claim.result });
  if (claim.state === "unavailable") return refuse(503, "unavailable", "The assistant cannot make changes yet: its setup is not finished in this workspace. Use the Competitors tab instead.");
  if (claim.state === "busy") return refuse(409, "in_progress", "This card is already being processed.");
  const handle = { cardId, tenantId: ctx.tenantId, userId: ctx.userId };

  try {
    const { POST } = await import("@/app/api/opportunities/[id]/competitors/route");
    const req = new NextRequest(new URL(route, ctx.baseUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: parsed.value.name, country: parsed.value.country, notes: parsed.value.notes }),
    });
    const res = await runVia("assistant", () => POST(req, { params: Promise.resolve({ id: dealId }) }));
    const json = (await res.json().catch(() => ({}))) as { competitor?: { id?: string; name?: string } | null; error?: string };
    const made = json.competitor;
    if (!res.ok || !made?.id) {
      const message = json.error ?? "The competitor could not be added.";
      await finishCard(ctx.admin, handle, { status: "failed", result: { error: message, status: res.status } });
      return refuse(res.status === 404 ? 422 : res.status >= 500 ? 502 : res.status, "route_refused", message);
    }
    const ref = opp.ref ?? "this tender";
    const record = { id: made.id, href: `${ROUTES.pipelineDetail(dealId)}?tab=competitors`, label: made.name ?? parsed.value.name };
    await finishCard(ctx.admin, handle, { status: "done", result: record });
    return {
      status: 200,
      body: { ok: true, record, next: [{ id: `analyse:${made.id}`, label: "See the analysis", kind: "ask", question: `Analyse the competitors on ${ref}` }] },
    };
  } catch (e) {
    console.error("Assistant competitor add failed:", e);
    await finishCard(ctx.admin, handle, { status: "failed", result: { error: "The competitor could not be added." } });
    return refuse(500, "failed", "The competitor could not be added.");
  }
}
