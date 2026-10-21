import type { PillarKey } from "@/lib/theme";
import { MESSAGE_CHANNELS, MESSAGE_DIRECTIONS, MONITOR_STATUSES, type MessageChannel, type MessageDirection, type MessageFilters, type MonitorMessage, type MonitorStatus } from "./api";

// The Monitor tab's pure parts: the filters and the query they become, and the
// plain words for a status. One vocabulary: Sent to <system>, Failed, Waiting,
// Skipped, Redirected (demo). No status codes in a chip.

export const EMPTY_FILTERS: MessageFilters = {};

export function hasFilters(f: MessageFilters): boolean {
  return Object.values(f).some((v) => v !== undefined && v !== "");
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d: string | undefined): d is string => !!d && DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** Days are calendar days in UTC, so the same filter means the same rows for everyone. */
export const dayStart = (d: string) => `${d}T00:00:00.000Z`;
export const dayEnd = (d: string) => `${d}T23:59:59.999Z`;

/** The query string for GET /api/middleware/messages. Unknown or empty values are left out. */
export function filtersToQuery(f: MessageFilters, opts: { cursor?: string | null; limit?: number } = {}): string {
  const p = new URLSearchParams();
  if (f.direction && (MESSAGE_DIRECTIONS as readonly string[]).includes(f.direction)) p.set("direction", f.direction);
  if (f.channel && (MESSAGE_CHANNELS as readonly string[]).includes(f.channel)) p.set("channel", f.channel);
  if (f.status && MONITOR_STATUSES.includes(f.status)) p.set("status", f.status);
  if (validDay(f.from)) p.set("from", dayStart(f.from));
  if (validDay(f.to)) p.set("to", dayEnd(f.to));
  if (f.object_id && /^[0-9a-f-]{32,40}$/i.test(f.object_id)) p.set("object_id", f.object_id);
  if (f.document && /^[a-z_]{1,30}$/.test(f.document)) p.set("document", f.document);
  const q = f.q?.trim();
  if (q) p.set("q", q.slice(0, 100));
  if (opts.cursor) p.set("cursor", opts.cursor);
  if (opts.limit) p.set("limit", String(Math.max(1, Math.min(100, Math.trunc(opts.limit)))));
  return p.toString();
}

/** A date range that runs backwards would show nothing: say so before asking. */
export function filterProblem(f: MessageFilters): string | null {
  if (validDay(f.from) && validDay(f.to) && f.from > f.to) return "The end date is before the start date.";
  return null;
}

export const DIRECTION_WORD: Record<MessageDirection, string> = { in: "In", out: "Out" };
export const CHANNEL_WORD: Record<MessageChannel, string> = { email: "Email", whatsapp: "WhatsApp", webhook: "Webhook", connector: "Connector", api: "API" };

/** The system a connector message is about, in the chip ("Sent to Dynamics 365"). */
export function statusWord(m: Pick<MonitorMessage, "status" | "direction" | "channel">, system = "the ERP"): string {
  switch (m.status) {
    case "ok":
      if (m.direction === "in") return m.channel === "connector" ? `Received from ${system}` : "Received";
      return m.channel === "connector" ? `Sent to ${system}` : "Sent";
    case "failed": return "Failed";
    case "pending": return "Waiting";
    case "skipped": return "Skipped";
    case "redirected": return "Redirected (demo)";
    case "dry_run": return "Dry run";
  }
}

/** The filter's own wording for a status, which does not depend on direction. */
export function statusFilterWord(s: MonitorStatus, system = "the ERP"): string {
  switch (s) {
    case "ok": return `Sent or received (${system})`;
    case "failed": return "Failed";
    case "pending": return "Waiting";
    case "skipped": return "Skipped";
    case "redirected": return "Redirected (demo)";
    case "dry_run": return "Dry run";
  }
}

export const statusTone = (s: MonitorStatus): PillarKey =>
  s === "ok" ? "green" : s === "failed" ? "red" : s === "pending" ? "amber" : s === "redirected" ? "purple" : "blue";

/** "1.2 s", "340 ms", or a dash when the source does not record it. */
export function durationWord(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** Where a record named in a message lives in the app, for the "Open" link. Types the app has no page for give null. */
export function recordHref(r: MonitorMessage["record"]): string | null {
  if (!r?.id) return null;
  const base: Record<string, string> = {
    accounts: "/accounts", contacts: "/contacts", products: "/products", standard_quotes: "/standard-quotes", quotations: "/quotations",
    cases: "/cases", invoices: "/invoices", suppliers: "/suppliers", rfqs: "/rfqs", fence_projects: "/fence-projects",
  };
  const b = base[r.type];
  return b ? `${b}/${r.id}` : null;
}

/** A readable name for a record type in the list ("Standard Quote", not "standard_quotes"). */
export function recordTypeWord(type: string): string {
  const w = type.replace(/_/g, " ").replace(/s$/, "");
  return w.charAt(0).toUpperCase() + w.slice(1);
}
