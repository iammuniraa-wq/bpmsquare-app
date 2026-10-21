import { MAX_SELECT_IDS, MAX_SELECT_TEXT, parseSelection } from "@/lib/connectors/d365/selection";
import type { EntitySchedule, RunFilters, SyncEntity } from "./api";

// The Resync tab's pure parts: the one-line "last run", the schedule choices, the
// filters of a full resync and the "Specific records" box. Messages and failures
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

// ── Filters of a full resync ────────────────────────────────────────────────

export type FilterDraft = { since: string; text: string; activeOnly: boolean };
export const NO_FILTERS: FilterDraft = { since: "", text: "", activeOnly: false };

export const hasFilters = (d: FilterDraft): boolean => !!d.since || !!d.text.trim() || d.activeOnly;

/** The request body for the filters, or a problem to show beside the field. */
export function filtersToRequest(d: FilterDraft): { ok: true; filters: RunFilters } | { ok: false; error: string } {
  const text = d.text.trim();
  if (text.length > MAX_SELECT_TEXT) return { ok: false, error: `Contains takes at most ${MAX_SELECT_TEXT} characters.` };
  const filters: RunFilters = {};
  if (d.since) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.since)) return { ok: false, error: "Changed since must be a date." };
    filters.since = d.since;
  }
  if (text) filters.text = text;
  if (d.activeOnly) filters.active_only = true;
  return { ok: true, filters };
}

/** "1 Oct" this year, "1 Oct 2025" otherwise. Read from the text, not through Date, so no time zone can move the day. */
export function dayWord(ymd: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const mon = new Date(2000, Number(m[2]) - 1, 1).toLocaleString("en", { month: "short" });
  return `${Number(m[3])} ${mon}${Number(m[1]) === now.getFullYear() ? "" : ` ${m[1]}`}`;
}

/** What a full resync will read, in the words the owner used: `Customers changed since 1 Oct, name contains "AG"`. Without filters: everything. */
export function filterLine(entity: string, d: FilterDraft, now: Date = new Date()): string {
  if (!hasFilters(d)) return `${entity}: everything`;
  const bits: string[] = [];
  if (d.since) bits.push(`changed since ${dayWord(d.since, now)}`);
  if (d.text.trim()) bits.push(`name or number contains "${d.text.trim()}"`);
  if (d.activeOnly) bits.push("active only");
  return `${entity} ${bits.join(", ")}`;
}

/** Filters set that this entity cannot apply, so the row can say so before the run rather than after. */
export function unsupportedFilters(support: SyncEntity["filters"], d: FilterDraft): string[] {
  if (!support) return [];
  const out: string[] = [];
  if (d.since && !support.since) out.push("Changed since");
  if (d.text.trim() && !support.text) out.push("Contains");
  if (d.activeOnly && !support.active) out.push("Active only");
  return out;
}

/** How a finished run is told back: counts first, then anything that was not applied. */
export function resultLine(r: { counts?: Record<string, number> }): string {
  const c = r.counts ?? {};
  const bits = [`${c.read ?? 0} read`, `${c.created ?? 0} new`, `${c.updated ?? 0} updated`, `${c.unchanged ?? 0} unchanged`];
  if (c.skipped) bits.push(`${c.skipped} skipped`);
  if (c.failed) bits.push(`${c.failed} failed`);
  return bits.join(", ");
}

const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

/** A blocker shown before the run: numbers typed for an entity that can only be read by id. */
export function numbersProblem(support: SyncEntity["filters"], ids: readonly string[]): string | null {
  if (!support || support.numbers) return null;
  const bad = ids.filter((t) => !GUID.test(t));
  return bad.length ? `This entity can only be read by record id, not by number (${bad.slice(0, 2).join(", ")}${bad.length > 2 ? ", ..." : ""}).` : null;
}
