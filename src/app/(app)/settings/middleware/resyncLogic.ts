import type { EntitySchedule, SyncEntity } from "./api";

// The Resync tab's pure parts: the one-line "last run", the schedule choices and
// the "Only these records" box. Messages and failures are the Monitor's, not here.

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
  return `${when}, ${n} record${n === 1 ? "" : "s"}`;
}

/** Ids or numbers typed with commas, spaces or new lines. Duplicates and blanks go; at most 500, like the server. */
export function parseRecordIds(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const p = part.trim().slice(0, 100);
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= 500) break;
  }
  return out;
}
