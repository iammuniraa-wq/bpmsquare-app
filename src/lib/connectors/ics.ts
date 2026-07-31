/**
 * Minimal iCalendar (RFC 5545) parser -- just enough to pull SUMMARY/DTSTART
 * out of a Google Calendar "secret address in iCal format" feed for the
 * Connectors test action. Deliberately not a full-spec parser (no RRULE
 * recurrence expansion, no timezone database) -- good enough to prove the
 * connection works and show what's coming up, not to power real scheduling.
 */
export type IcsEvent = { summary: string; start: Date | null };

function unfold(text: string): string[] {
  const raw = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseIcsDate(value: string): Date | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : ""}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function parseIcsEvents(text: string): IcsEvent[] {
  const lines = unfold(text);
  const events: IcsEvent[] = [];
  let inEvent = false;
  let summary = "";
  let start: Date | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") { inEvent = true; summary = ""; start = null; continue; }
    if (line === "END:VEVENT") {
      if (inEvent) events.push({ summary: summary || "(no title)", start });
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    if (key === "SUMMARY") summary = value;
    else if (key.startsWith("DTSTART")) start = parseIcsDate(value);
  }
  return events;
}
