import { csvCell } from "@/lib/import/template";

export type ChangeEntry = { field: string; from: unknown; to: unknown; redacted?: boolean };
export type ChangeLogRow = {
  id: string;
  object_type: string;
  object_id: string;
  object_label: string | null;
  action: "create" | "update" | "delete" | "reopen";
  changes: ChangeEntry[];
  actor_id: string | null;
  actor_email: string | null;
  /** The person's name (business user label or employee name), or null when none is known. */
  actor_name?: string | null;
  /** Which surface made the change; 'assistant' when a confirm card did, empty for the ordinary screens. Absent until migration 0205 is applied. */
  via?: string | null;
  created_at: string;
};

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export function summarizeChanges(row: ChangeLogRow): string {
  if (row.action === "create") return "Record created";
  if (row.action === "delete") return "Record deleted";
  if (row.changes.length === 0) return "—";
  return row.changes.map((ch) => `${ch.field}: ${formatValue(ch.from)} → ${formatValue(ch.to)}`).join("; ");
}

/** Who made the change, as a name: never a login address. Falls back to the part before the @ for a user with no name on file. */
export function byLabel(r: { actor_name?: string | null; actor_email?: string | null }): string {
  if (r.actor_name?.trim()) return r.actor_name.trim();
  const local = r.actor_email?.split("@")[0]?.trim();
  return local || "—";
}

/** "via assistant" for a change a confirm card made; null for the ordinary screens and for rows from before the column existed. */
export function viaLabel(via: unknown): string | null {
  if (typeof via !== "string" || !via.trim()) return null;
  return `via ${via.trim()}`;
}

export const CSV_HEADER = ["Date", "Action", "Object Type", "Object ID", "Record", "Changed by", "Via", "Changes"];

export function csvRow(r: ChangeLogRow): string {
  return [r.created_at, r.action, r.object_type, r.object_id, r.object_label ?? "", byLabel(r), r.via ?? "", summarizeChanges(r)]
    .map((v) => csvCell(String(v)))
    .join(",");
}

export function buildCsv(rows: readonly ChangeLogRow[]): string {
  return "﻿" + [CSV_HEADER.join(","), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}
