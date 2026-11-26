import "server-only";
import crypto from "crypto";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardField, ConfirmCard } from "@/lib/assistant/cards";
import { CARD_TIPS } from "@/lib/assistant/cardTips";
import { redactText } from "@/lib/middleware/redact";
import type { UpdateActionDef } from "./registry";
import { auditValues, hash8, loadSpec, normaliseValue, structureHash, type SpecField } from "./card";
import { claimCard, finishCard } from "./ledger";
import { loadRecordRow, notOneMessage, resolveRecord, type RecordTarget, type Row } from "./records";
import { refuse, routeStatus, type ActBody, type ExecCtx, type ExecOutcome } from "./outcome";
import { hashOf, signToken, type TokenPayload } from "./token";
import { runVia } from "./via";

// A change card: "set the city of Acme to Dammam". The server resolves the record (never the model), reads what the fields hold
// now and draws before and after for each field the person is changing. The press runs the object's own PATCH route on the
// person's own session, so that route's allow-list, tenant filter, encryption and Change History ("via assistant") are the screen's.
// Only the plain fields named in the registry are ever offered: no status, stage, owner, foreign id or money total.

export type UpdateInput = { record?: string; values: Record<string, string>; summary: string; pageRecordId?: string | null };

export type UpdateBuild =
  | { ok: true; card: ConfirmCard; ignored: string[] }
  | { ok: false; reason: string };

export const targetOf = (def: UpdateActionDef): RecordTarget => ({
  table: def.table, nameColumn: def.nameColumn, tenderOnly: def.tenderOnly, extraRef: def.object === "product" ? "sku" : undefined,
});

const readOf = (def: UpdateActionDef, row: Row): Row => (def.readRow ? def.readRow(row) : row);

const plain = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? "" : String(v).trim());

/** What a value reads as on a screen: an option's label, yes or no, a number without trailing noise, a date without its time. */
export function displayValue(f: Pick<SpecField, "widget" | "options">, raw: unknown): string {
  const s = plain(raw);
  if (!s) return "";
  if (f.widget === "enum") return f.options?.find((o) => o.value === s || o.value.toLowerCase() === s.toLowerCase())?.label ?? s;
  if (f.widget === "checkbox") return s === "true" ? "Yes" : s === "false" ? "No" : s;
  if (f.widget === "number") return Number.isFinite(Number(s)) ? String(Number(s)) : s;
  if (f.widget === "date") return s.slice(0, 10);
  return s;
}

/** Is this already what the record holds? Compared the way the field is typed, so "180.50" and 180.5 are the same price. */
export function sameValue(f: Pick<SpecField, "widget">, current: unknown, next: string): boolean {
  const a = plain(current);
  if (f.widget === "number") return a !== "" && Number.isFinite(Number(a)) && Number(a) === Number(next);
  if (f.widget === "date") return a.slice(0, 10) === next;
  if (f.widget === "checkbox") return a === next;
  return a.toLowerCase() === next.toLowerCase();
}

const beforeHash = (row: Row, keys: string[]): string => hashOf([...keys].sort().map((k) => [k, plain(row[k])]));

export async function buildUpdateCard(
  ctx: { supabase: SupabaseClient; tenantId: string; userId: string },
  def: UpdateActionDef,
  input: UpdateInput,
  newId: () => string = () => crypto.randomUUID(),
): Promise<UpdateBuild> {
  const spec = await loadSpec(ctx.supabase, ctx.tenantId, def);
  const byKey = new Map(spec.fields.map((f) => [f.key, f]));

  const found = await resolveRecord(ctx.supabase, ctx.tenantId, targetOf(def), input.record, input.pageRecordId);
  if (found.kind !== "one") return { ok: false, reason: notOneMessage(def.noun, input.record, found) };
  const row = readOf(def, found.row);
  const label = def.labelOf(row) || def.noun;

  const changed: Record<string, string> = {};
  const ignored: string[] = [];
  const notices: string[] = [];
  const same: string[] = [];
  for (const [k, raw] of Object.entries(input.values ?? {})) {
    const f = byKey.get(k);
    if (!f || f.kind === "ref") { ignored.push(k); continue; }
    const n = normaliseValue(f, raw);
    if (!n.ok) { notices.push(n.error); continue; }
    // Emptying a field is not done from the chat: the person clears it on the record.
    if (!n.value) { ignored.push(k); continue; }
    if (sameValue(f, row[k], n.value)) { same.push(f.label); continue; }
    changed[k] = n.value;
  }

  const keys = Object.keys(changed);
  if (keys.length === 0) {
    if (notices.length > 0) return { ok: false, reason: `No card: ${notices.join(" ")} Tell the person what was wrong and ask for the value again.` };
    if (same.length > 0) return { ok: false, reason: `Nothing to change: ${same.join(", ")} already ${same.length === 1 ? "has" : "have"} that value on ${label}. Tell the person; no card has been shown.` };
    return {
      ok: false,
      reason: `None of those are fields you can change on a ${def.noun}${ignored.length ? ` (ignored: ${ignored.join(", ")})` : ""}. Use the field keys from CHANGEABLE; a field cannot be emptied from the chat. No card has been shown.`,
    };
  }

  const fields: CardField[] = spec.fields
    .filter((f) => changed[f.key] !== undefined)
    .map((f) => ({ key: f.key, label: f.label, value: changed[f.key], before: displayValue(f, row[f.key]), required: false, widget: f.widget, options: f.options }));

  const cardId = newId();
  const summary = input.summary.slice(0, 240);
  const token = signToken({
    cid: cardId, tid: ctx.tenantId, uid: ctx.userId, act: def.key, h: structureHash(def, spec), dup: "", sm: summary,
    pv: Object.fromEntries(keys.map((k) => [k, hash8(changed[k])])),
    tg: { id: found.id }, bf: beforeHash(row, keys),
  });

  if (same.length > 0) notices.push(`Already set, left out: ${same.join(", ")}.`);
  return {
    ok: true, ignored,
    card: {
      id: cardId, token, action: "update", object: def.object, noun: def.noun, title: `Change ${def.noun}: ${label}`, summary,
      fields, duplicates: [], notices, primaryLabel: "Save changes", risk: "write", info: CARD_TIPS.update,
    },
  };
}

/** The body the object's own PATCH takes: typed values for numbers and yes/no, text for the rest. */
function patchBody(fields: SpecField[], values: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined) continue;
    body[f.key] = f.widget === "number" ? Number(v) : f.widget === "checkbox" ? v === "true" : v;
  }
  return body;
}

export async function executeUpdate(ctx: ExecCtx, body: ActBody, payload: TokenPayload, def: UpdateActionDef, cardId: string): Promise<ExecOutcome> {
  const spec = await loadSpec(ctx.supabase, ctx.tenantId, def);
  if (structureHash(def, spec) !== payload.h) return refuse(409, "stale", "The fields changed since this card was shown. Ask me again.");

  if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) return refuse(400, "values", "No values were sent.");
  const raw = body.values as Record<string, unknown>;
  const offered = new Set(Object.keys(payload.pv));
  const byKey = new Map(spec.fields.map((f) => [f.key, f]));
  const unknown = Object.keys(raw).filter((k) => !offered.has(k) || !byKey.has(k));
  if (unknown.length) return refuse(422, "unknown_field", "A field that is not on the card was sent.", { fields: unknown });

  const values: Record<string, string> = {};
  for (const f of spec.fields) {
    if (!offered.has(f.key)) continue;
    const n = normaliseValue(f, raw[f.key]);
    if (!n.ok) return refuse(422, "invalid", n.error, { errors: { [f.key]: n.error } });
    if (n.value) values[f.key] = n.value;
  }
  if (Object.keys(values).length === 0) return refuse(422, "nothing", "There is nothing to change: every field on the card is empty.");

  const id = typeof payload.tg?.id === "string" ? payload.tg.id : "";
  const current = await loadRecordRow(ctx.supabase, ctx.tenantId, targetOf(def), id);
  if (!current) return refuse(422, "record", `This ${def.noun} was not found in this workspace.`);
  const row = readOf(def, current);
  if (beforeHash(row, Object.keys(payload.pv)) !== payload.bf) return refuse(409, "stale_record", `This ${def.noun} changed since the card was shown. Ask me again and I will show what it holds now.`);

  const label = def.labelOf(row) || def.noun;
  const applied = spec.fields.filter((f) => values[f.key] !== undefined && !sameValue(f, row[f.key], values[f.key]));
  const route = def.route.replace("[id]", id);
  const shown = {
    action: def.key, object: def.object, summary: redactText(payload.sm), record: { id, label: redactText(label) },
    fields: spec.fields.filter((f) => offered.has(f.key)).map((f) => ({ key: f.key, label: f.label })),
    proposed_keys: Object.keys(payload.pv),
    edited: Object.keys(values).filter((k) => payload.pv[k] !== hash8(values[k])),
    values: auditValues(def, values),
    before: auditValues(def, Object.fromEntries(applied.map((f) => [f.key, plain(row[f.key])]))),
  };

  const claim = await claimCard(ctx.admin, {
    cardId, tenantId: ctx.tenantId, userId: ctx.userId, kind: "update", actionKey: def.key, route, card: shown, params: { id, values: shown.values },
  });
  if (claim.state === "done") return refuse(409, "already_done", "This card has already been used.", { result: claim.result });
  if (claim.state === "unavailable") return refuse(503, "unavailable", "The assistant cannot make changes yet: its setup is not finished in this workspace. Use the screen instead.");
  if (claim.state === "busy") return refuse(409, "in_progress", "This card is already being processed.");
  const handle = { cardId, tenantId: ctx.tenantId, userId: ctx.userId };

  try {
    const { PATCH } = await def.load();
    const req = new NextRequest(new URL(route, ctx.baseUrl), {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patchBody(spec.fields, values)),
    });
    const res = await runVia("assistant", () => PATCH(req, { params: Promise.resolve({ id }) }));
    const json = (await res.json().catch(() => ({}))) as Row & { error?: string };
    if (!res.ok) {
      const message = typeof json.error === "string" && json.error ? json.error : `The ${def.noun} could not be changed.`;
      await finishCard(ctx.admin, handle, { status: "failed", result: { error: redactText(message), status: res.status } });
      return refuse(routeStatus(res.status), "route_refused", message);
    }
    const after = typeof json.id === "string" ? def.labelOf(readOf(def, json)) : "";
    const record = { id, href: def.hrefFor(id), label: after || label };
    const n = applied.length;
    const message = n === 0 ? `Nothing needed changing on ${record.label}` : `Saved ${n} change${n === 1 ? "" : "s"} to ${record.label}`;
    const details = applied.map((f) => `${f.label}: ${displayValue(f, row[f.key]) || "empty"} → ${displayValue(f, values[f.key])}`);
    await finishCard(ctx.admin, handle, { status: "done", result: { ...record, message } });
    return { status: 200, body: { ok: true, record, next: def.next({ id, label: record.label }), message, details } };
  } catch (e) {
    console.error("Assistant change failed:", e);
    await finishCard(ctx.admin, handle, { status: "failed", result: { error: `The ${def.noun} could not be changed.` } });
    return refuse(500, "failed", `The ${def.noun} could not be changed.`);
  }
}
