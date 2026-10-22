import { MAX_SELECT_IDS, parseSelection } from "@/lib/connectors/d365/selection";
import { MAX_SCOPE_CONDITIONS, MAX_SCOPE_VALUES, conditionId, type ScopeAttribute } from "@/lib/connectors/d365/scope";
import type { ScopeCondition } from "@/lib/connectors/d365/types";
import type { EntitySchedule, ScopeSave, SyncEntity } from "./api";

// The Resync tab's pure parts: the one-line "last run", the schedule choices, the
// Scope of an entity and the "Specific records" box. Messages and failures
// are the Monitor's, not here.

export const RESYNC_TABS = ["full", "records"] as const;
export type ResyncTabId = (typeof RESYNC_TABS)[number];
export const RESYNC_TAB_LABEL: Record<ResyncTabId, string> = { full: "Full resync", records: "Specific records" };

export const SCHEDULE_CHOICES: { id: EntitySchedule; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "hourly", label: "Hourly" },
  { id: "daily", label: "Daily" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today 17:29", "Yesterday 09:05", or "3 Oct" (local time; `now` is passed so a test can fix it). */
export function whenWord(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, now)) return `Today ${hm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `Yesterday ${hm}`;
  return `${d.getDate()} ${d.toLocaleString("en", { month: "short" })}`;
}

/** The one line under an entity: "Today 17:29, 6 records", "Not run yet", "Running now", "Today 17:29, failed". */
export function lastRunLine(e: Pick<SyncEntity, "running" | "last_run">, now: Date = new Date()): string {
  if (e.running) return "Running now";
  const r = e.last_run;
  if (!r) return "Not run yet";
  if (r.status === "running") return "Running now";
  const when = whenWord(r.finished_at ?? r.started_at, now);
  if (r.status === "failed" || r.status === "error") return `${when}, failed`;
  const c = r.counts ?? {};
  const n = typeof c.read === "number" ? c.read : (c.created ?? 0) + (c.updated ?? 0) + (c.unchanged ?? 0);
  return `${when}, ${n} record${n === 1 ? "" : "s"}${c.filtered ? ", filtered" : ""}`;
}

/** Ids or numbers typed with commas, spaces or new lines. Duplicates and blanks go; at most 100, like the server. */
export function parseRecordIds(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const p = part.trim().slice(0, 100);
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= MAX_SELECT_IDS) break;
  }
  return out;
}

/** Why the typed ids cannot be sent, or null. The server checks again; this only saves the round trip. */
export function recordIdsProblem(text: string): string | null {
  const all = new Set(text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean));
  if (all.size > MAX_SELECT_IDS) return `Up to ${MAX_SELECT_IDS} records at a time.`;
  const r = parseSelection({ ids: [...all] });
  return r.ok ? null : r.error;
}

// ── Scope of an entity ───────────────────────────────────────────────────────

/** The cell under "Scope": the saved words, or "All customers". An older server that sends none reads as all. */
export function scopeCell(e: Pick<SyncEntity, "key" | "scope">): string {
  return e.scope?.summary ?? `All ${e.key.replace(/_/g, " ")}`;
}

/** One condition being edited. `id` is the attribute id the scope route lists ("territoryid", "customer:territoryid"). */
export type ConditionDraft = { id: string; values: string[]; labels: string[] };
export type ScopeDraft = ConditionDraft[];

export function draftFromScope(conditions: readonly ScopeCondition[]): ScopeDraft {
  return conditions.map((c) => ({ id: conditionId(c), values: [...c.values], labels: c.values.map((v, i) => c.labels?.[i] || v) }));
}

/** The next attribute not used yet, the common ones first (they come first in the list). */
export function addCondition(draft: ScopeDraft, attributes: readonly ScopeAttribute[]): ScopeDraft {
  if (draft.length >= MAX_SCOPE_CONDITIONS) return draft;
  const free = attributes.find((a) => !draft.some((c) => c.id === a.id));
  return free ? [...draft, { id: free.id, values: [], labels: [] }] : draft;
}

/** Changing the attribute of a row starts its values again: a code of one attribute means nothing for another. */
export function setConditionAttribute(draft: ScopeDraft, index: number, id: string): ScopeDraft {
  return draft.map((c, i) => (i === index ? { id, values: [], labels: [] } : c));
}

export function toggleConditionValue(draft: ScopeDraft, index: number, value: string, label: string): ScopeDraft {
  return draft.map((c, i) => {
    if (i !== index) return c;
    const at = c.values.indexOf(value);
    if (at !== -1) return { ...c, values: c.values.filter((_, j) => j !== at), labels: c.labels.filter((_, j) => j !== at) };
    if (c.values.length >= MAX_SCOPE_VALUES) return c;
    return { ...c, values: [...c.values, value], labels: [...c.labels, label || value] };
  });
}

export const removeCondition = (draft: ScopeDraft, index: number): ScopeDraft => draft.filter((_, i) => i !== index);

/** Why the draft cannot be saved yet, or null. The server checks again; this only saves the round trip. */
export function scopeProblem(draft: ScopeDraft, attributes: readonly ScopeAttribute[]): string | null {
  if (draft.length > MAX_SCOPE_CONDITIONS) return `A scope takes at most ${MAX_SCOPE_CONDITIONS} conditions.`;
  const seen = new Set<string>();
  for (const c of draft) {
    const a = attributes.find((x) => x.id === c.id);
    if (!a) return "One of the attributes is no longer in the system. Remove it or choose another.";
    if (seen.has(c.id)) return `${a.label} is used twice. Put its values in one row.`;
    seen.add(c.id);
    if (c.values.length === 0) return `Choose at least one value for ${a.label}.`;
  }
  return null;
}

/** The request body of a save. */
export function draftToSave(draft: ScopeDraft): ScopeSave {
  return draft.map((c) => ({ attribute: c.id.replace(/^customer:/, ""), values: c.values, labels: c.labels, ...(c.id.startsWith("customer:") ? { via: "customer" as const } : {}) }));
}

export function sameDraft(a: ScopeDraft, b: ScopeDraft): boolean {
  return JSON.stringify(a.map((c) => [c.id, c.values])) === JSON.stringify(b.map((c) => [c.id, c.values]));
}

/** Typed values: commas or new lines, blanks and duplicates dropped, at most 50 like the server. */
export function parseTypedValues(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    const p = part.trim().slice(0, 100);
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= MAX_SCOPE_VALUES) break;
  }
  return out;
}

/** How a finished run is told back: counts first, then anything that was not applied. */
export function resultLine(r: { counts?: Record<string, number> }): string {
  const c = r.counts ?? {};
  const bits = [`${c.read ?? 0} read`, `${c.created ?? 0} new`, `${c.updated ?? 0} updated`, `${c.unchanged ?? 0} unchanged`];
  if (c.skipped) bits.push(`${c.skipped} skipped`);
  if (c.failed) bits.push(`${c.failed} failed`);
  if (c.outside_scope) bits.push(`${c.outside_scope} outside scope left unchanged`);
  return bits.join(", ");
}

const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

/** A blocker shown before the run: numbers typed for an entity that can only be read by id. */
export function numbersProblem(support: SyncEntity["filters"], ids: readonly string[]): string | null {
  if (!support || support.numbers) return null;
  const bad = ids.filter((t) => !GUID.test(t));
  return bad.length ? `This entity can only be read by record id, not by number (${bad.slice(0, 2).join(", ")}${bad.length > 2 ? ", ..." : ""}).` : null;
}
