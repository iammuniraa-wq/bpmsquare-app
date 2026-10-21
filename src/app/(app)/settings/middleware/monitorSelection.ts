import type { MessageFilters, MonitorMessage, MonitorStatus, PayloadView, RestartResult } from "./api";
import { filtersToQuery } from "./monitorLogic";

// The Monitor list's pure parts: which lines are ticked, what the action bar
// offers for them, what a restart answered, and how a payload reads.

// ── Filter chips ────────────────────────────────────────────────────────────

export const STATUS_CHIPS: { id: "all" | MonitorStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "failed", label: "Failed" },
  { id: "pending", label: "Waiting" },
  { id: "ok", label: "OK" },
];

export const DOCUMENT_FILTERS: { id: string; label: string }[] = [
  { id: "", label: "Everything" },
  { id: "quote", label: "Quote" },
  { id: "customers", label: "Customers" },
  { id: "contacts", label: "Contacts" },
  { id: "products", label: "Products" },
  { id: "projects", label: "Projects" },
];

/** The list route has no document filter yet, so the page narrows what it loaded by the row's own word ("Quote", "Customers"). */
export function matchesDocument(m: Pick<MonitorMessage, "what">, document: string | undefined): boolean {
  if (!document) return true;
  const label = DOCUMENT_FILTERS.find((d) => d.id === document)?.label ?? document;
  return (m.what ?? "").toLowerCase() === label.toLowerCase();
}

// ── Ticks ───────────────────────────────────────────────────────────────────

export const restartableIds = (items: readonly MonitorMessage[]): string[] => items.filter((m) => m.restartable).map((m) => m.id);

/** Tick or untick one line. Every line can be ticked (to read its payload); Restart acts on the restartable ones. */
export function toggleTick(ticked: readonly string[], items: readonly MonitorMessage[], id: string): string[] {
  if (!items.some((x) => x.id === id)) return [...ticked];
  return ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id];
}

/** Select-all covers the lines loaded now: all ticked -> none, otherwise every line. */
export function toggleAll(ticked: readonly string[], items: readonly MonitorMessage[]): string[] {
  return items.length > 0 && items.every((m) => ticked.includes(m.id)) ? [] : items.map((m) => m.id);
}

/** After the list changes, a tick on a line that is no longer there goes. */
export const pruneTicks = (ticked: readonly string[], items: readonly MonitorMessage[]): string[] => {
  const here = new Set(items.map((m) => m.id));
  return ticked.filter((id) => here.has(id));
};

/** The ticked lines that Restart can act on. */
export const restartableTicked = (ticked: readonly string[], items: readonly MonitorMessage[]): string[] => {
  const ok = new Set(restartableIds(items));
  return ticked.filter((id) => ok.has(id));
};

// ── The action bar ──────────────────────────────────────────────────────────

export type ActionBar = {
  restartLabel: string;
  restartEnabled: boolean;
  /** "ticked" restarts the ticked lines; "all-failed" restarts every failed line the filter shows (confirmed once). */
  restartMode: "ticked" | "all-failed" | "none";
  viewRequest: { disabled: boolean; reason: string | null };
  viewResponse: { disabled: boolean; reason: string | null };
  /** The single ticked line, when exactly one is. */
  one: MonitorMessage | null;
};

export function actionBar(items: readonly MonitorMessage[], ticked: readonly string[], filters: MessageFilters, hasMore: boolean): ActionBar {
  const lines = ticked.map((id) => items.find((m) => m.id === id)).filter((m): m is MonitorMessage => !!m);
  const one = lines.length === 1 ? lines[0] : null;
  const failedShown = restartableIds(items).length;
  let restartLabel = "Restart";
  let restartMode: ActionBar["restartMode"] = "none";
  const canRestart = lines.filter((m) => m.restartable).length;
  if (canRestart > 0) { restartMode = "ticked"; restartLabel = canRestart === 1 ? "Restart" : `Restart (${canRestart})`; }
  else if (lines.length === 0 && filters.status === "failed" && failedShown > 0) { restartMode = "all-failed"; restartLabel = `Restart all failed (${failedShown}${hasMore ? "+" : ""})`; }
  const view = (): { disabled: boolean; reason: string | null } => {
    if (!one) return { disabled: true, reason: "Select one line" };
    if (!one.hasPayload) return { disabled: true, reason: "No payload recorded" };
    return { disabled: false, reason: null };
  };
  return { restartLabel, restartEnabled: restartMode !== "none", restartMode, viewRequest: view(), viewResponse: view(), one };
}

/** The filter as the restart route takes it: the same names as the list query. */
export function filterAsRecord(f: MessageFilters): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(filtersToQuery(f)));
}

// ── What a restart answered ─────────────────────────────────────────────────

export const OUTCOME_WORD: Record<RestartResult["outcome"], string> = {
  done: "Done",
  failed: "Still failing",
  already_ok: "Already fine",
  not_restartable: "Cannot be restarted",
};

/** The text under a line after a restart: "Done", or "Still failing: <reason>". */
export function resultLine(r: RestartResult): string {
  return r.outcome === "failed" && r.message ? `${OUTCOME_WORD.failed}: ${r.message}` : r.message && r.outcome !== "done" && r.outcome !== "already_ok" ? `${OUTCOME_WORD[r.outcome]}: ${r.message}` : OUTCOME_WORD[r.outcome];
}

/** One line for the whole restart: "2 done, 1 still failing". */
export function resultsSummary(results: readonly RestartResult[]): string {
  if (results.length === 0) return "Nothing was restarted.";
  const n = (o: RestartResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  const parts = [
    n("done") ? `${n("done")} done` : null,
    n("failed") ? `${n("failed")} still failing` : null,
    n("already_ok") ? `${n("already_ok")} already fine` : null,
    n("not_restartable") ? `${n("not_restartable")} could not be restarted` : null,
  ].filter((x): x is string => !!x);
  return parts.join(", ") + ".";
}

// ── Payload ─────────────────────────────────────────────────────────────────

export type PayloadSide = "request" | "response";

/** Pretty-print a body: JSON text is re-indented, an object is stringified, anything else is shown as it is. */
export function prettyBody(body: unknown): string {
  if (body === null || body === undefined || body === "") return "No body.";
  if (typeof body === "string") {
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
  }
  try { return JSON.stringify(body, null, 2); } catch { return String(body); }
}

/** The one line above a payload: "POST /quotes" for a request, "HTTP 201 · 1.2 s" for a response. */
export function payloadLine(p: PayloadView, side: PayloadSide): string {
  if (side === "request") return p.request ? `${p.request.method} ${p.request.url}`.trim() : "";
  if (!p.response) return "";
  const parts: string[] = [];
  if (p.response.status !== null && p.response.status !== undefined) parts.push(`HTTP ${p.response.status}`);
  const ms = p.response.durationMs;
  if (typeof ms === "number" && Number.isFinite(ms)) parts.push(ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
  return parts.join(" · ");
}

export function payloadText(p: PayloadView, side: PayloadSide): string {
  return prettyBody(side === "request" ? p.request?.body : p.response?.body);
}

export const hasSide = (p: PayloadView | null, side: PayloadSide): boolean => !!p && (side === "request" ? !!p.request : !!p.response);
