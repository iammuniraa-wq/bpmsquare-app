import "server-only";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";
import type { CardDuplicate } from "@/lib/assistant/cards";
import { actionByKey, availableActions } from "./registry";
import { auditValues, dupHash, hash8, duplicatesFor, evaluateFields, loadSpec, normaliseValue, refExists, structureHash, toRouteBody } from "./card";
import { claimCard, finishCard } from "./ledger";
import { verifyToken } from "./token";
import { runVia } from "./via";

// A pressed confirm card becomes a create here, and nowhere else. Order matters and is the safety argument:
//   1 the token proves this server showed this person this card, for this workspace, and has not expired
//   2 the flag, the module and the Business Role are checked again, now, not as they were when the card was shown
//   3 the card's structure is rebuilt from the current field config and must match the token (a field config that
//     changed since is a stale card, not a silent mismatch)
//   4 the values are checked like the form checks them: only fields on the card, enums, dates, required fields
//     after the workspace's rules, foreign ids resolved inside this workspace
//   5 similar records are looked for again; a different set than the person saw asks them to look again
//   6 the card id is claimed once; a second press cannot run it again
//   7 the object's own route handler runs, in-process, on the person's own session
// The assistant never holds a database client of its own for the write: the route does it, exactly as for a click.

export type ExecCtx = {
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

export type ActBody = { card_id?: unknown; token?: unknown; values?: unknown; confirm_duplicates?: unknown };

export type ExecOutcome = { status: number; body: Record<string, unknown> };

const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): ExecOutcome =>
  ({ status, body: { ok: false, code, error, ...extra } });

export async function executeCard(ctx: ExecCtx, body: ActBody): Promise<ExecOutcome> {
  const cardId = typeof body.card_id === "string" ? body.card_id : "";
  const verified = verifyToken(body.token, { tenantId: ctx.tenantId, userId: ctx.userId, cardId }, ctx.now);
  if (!verified.ok) {
    return verified.reason === "expired"
      ? refuse(410, "expired", "This card has expired. Ask me again and I will show a fresh one.")
      : refuse(403, "token", "This card was not issued to you in this workspace.");
  }
  const payload = verified.payload;

  const def = actionByKey(payload.act);
  const allowed = def && availableActions({ features: ctx.features, perms: ctx.perms }).some((a) => a.key === def.key);
  if (!def || !allowed) return refuse(403, "not_allowed", "You are not allowed to do that here.");

  const spec = await loadSpec(ctx.supabase, ctx.tenantId, def);
  if (structureHash(def, spec) !== payload.h) return refuse(409, "stale", "The fields changed since this card was shown. Ask me again.");

  // Only fields the card offered, as plain values.
  if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) return refuse(400, "values", "No values were sent.");
  const raw = body.values as Record<string, unknown>;
  const byKey = new Map(spec.fields.map((f) => [f.key, f]));
  const unknown = Object.keys(raw).filter((k) => !byKey.has(k));
  if (unknown.length) return refuse(422, "unknown_field", "A field that is not on the card was sent.", { fields: unknown });

  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const f of spec.fields) {
    const n = normaliseValue(f, raw[f.key]);
    if (!n.ok) errors[f.key] = n.error;
    else if (n.value) values[f.key] = n.value;
  }
  if (Object.keys(errors).length) return refuse(422, "invalid", Object.values(errors)[0], { errors });

  const { required, hidden } = evaluateFields(spec, values);
  for (const k of hidden) delete values[k];
  const missing = [...required].filter((k) => !values[k]);
  if (missing.length) {
    const label = byKey.get(missing[0])?.label ?? missing[0];
    return refuse(422, "missing", `${label} is required.`, { missing });
  }

  for (const r of def.refs) {
    const id = values[r.key];
    if (id && !(await refExists(ctx.supabase, ctx.tenantId, r, id))) return refuse(422, "ref", `${r.label} was not found in this workspace.`, { missing: [r.key] });
  }

  const duplicates = await duplicatesFor(ctx.supabase, ctx.tenantId, def, values);
  if (duplicates.length > 0 && body.confirm_duplicates !== true && dupHash(duplicates) !== payload.dup) {
    return refuse(422, "duplicates_changed", "Similar records exist now. Have a look, then press Create again.", { duplicates });
  }

  const label = def.labelOf(values);
  const shown = {
    action: def.key, object: def.object, summary: payload.sm,
    fields: spec.fields.map((f) => ({ key: f.key, label: f.label, required: required.has(f.key) })),
    proposed_keys: Object.keys(payload.pv),
    edited: Object.keys(values).filter((k) => payload.pv[k] !== undefined && payload.pv[k] !== hash8(values[k])),
    added: Object.keys(values).filter((k) => payload.pv[k] === undefined),
    duplicates_shown: duplicates.map((d: CardDuplicate) => d.id),
    values: auditValues(def, values),
  };

  const claim = await claimCard(ctx.admin, {
    cardId, tenantId: ctx.tenantId, userId: ctx.userId, kind: "create",
    actionKey: def.key, route: def.route, card: shown, params: auditValues(def, values),
  });
  if (claim.state === "done") return refuse(409, "already_done", "This card has already been used.", { result: claim.result });
  if (claim.state === "busy") return refuse(409, "in_progress", "This card is already being processed.");
  const handle = { cardId, tenantId: ctx.tenantId, userId: ctx.userId, durable: claim.durable };

  try {
    const { POST } = await def.load();
    const req = new NextRequest(new URL(def.route, ctx.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toRouteBody(spec, values)),
    });
    const res = await runVia("assistant", () => POST(req));
    const json = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: string };
    if (!res.ok || !json.id) {
      const message = json.error ?? "The record could not be created.";
      await finishCard(ctx.admin, handle, { status: "failed", result: { error: message, status: res.status } });
      return refuse(res.status === 404 ? 422 : res.status >= 500 ? 502 : res.status, "route_refused", message);
    }
    const record = { id: json.id, href: def.hrefFor(json.id), label: json.name ?? label };
    await finishCard(ctx.admin, handle, { status: "done", result: record });
    return { status: 200, body: { ok: true, record, next: def.next({ id: record.id, label: record.label }) } };
  } catch (e) {
    console.error("Assistant action failed:", e);
    await finishCard(ctx.admin, handle, { status: "failed", result: { error: "The record could not be created." } });
    return refuse(500, "failed", "The record could not be created.");
  }
}
