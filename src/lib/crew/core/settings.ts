// What a workspace admin may tune and how the tile reads its state (docs/design/nova-crew-agents.md sections 3.1 and 3.7). Pure.

import { parseTime } from "./schedule";
import type { AgentConfig, AgentKey, Sensitivity } from "../types";

const SENSITIVITIES: readonly Sensitivity[] = ["quiet", "balanced", "thorough"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FAMILIES: Record<AgentKey, readonly string[]> = {
  tender_watch: [],
  // The kinds the engine has detectors for (src/lib/crew/attendance/facts.ts). Headcount, overtime, holiday-bridging and buddy-punch families are not built, so they are not offered.
  attendance: ["late_cluster", "missing_out_cluster", "far_punches"],
};

/**
 * The editable subset of an agent's config, from whatever the client sent. Unknown keys are dropped. `visibility` and `digest_optin` are NOT
 * editable here: visibility is a platform decision, the digest is each person's own switch. Both are carried over from `current`.
 */
export function sanitizeConfig(agent: AgentKey, input: unknown, current: AgentConfig): { config: AgentConfig; problems: string[] } {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const out: AgentConfig = { ...current };

  if (i.schedule && typeof i.schedule === "object") {
    const s = i.schedule as Record<string, unknown>;
    const time = parseTime(s.time);
    if (!time) problems.push("Pick a valid time of day.");
    const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : undefined;
    const weeklyDay = s.weeklyDay === undefined || s.weeklyDay === null ? undefined : Number(s.weeklyDay);
    if (weeklyDay !== undefined && !(Number.isInteger(weeklyDay) && weeklyDay >= 0 && weeklyDay <= 6)) problems.push("Pick a valid day of the week.");
    if (time) out.schedule = { time, ...(days && days.length > 0 && days.length < 7 ? { days } : {}), ...(weeklyDay !== undefined && Number.isInteger(weeklyDay) ? { weeklyDay } : {}) };
  }
  if (i.sensitivity !== undefined) {
    if (SENSITIVITIES.includes(i.sensitivity as Sensitivity)) out.sensitivity = i.sensitivity as Sensitivity;
    else problems.push("How sensitive must be Quiet, Balanced or Thorough.");
  }
  if (i.watch_window_days !== undefined && agent === "tender_watch") {
    const n = Number(i.watch_window_days);
    if (Number.isInteger(n) && n >= 3 && n <= 90) out.watch_window_days = n;
    else problems.push("The watch window is between 3 and 90 days.");
  }
  if (Array.isArray(i.recipient_ids)) out.recipient_ids = [...new Set(i.recipient_ids.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, 20);
  if (i.scope && typeof i.scope === "object") {
    const sc = i.scope as Record<string, unknown>;
    out.scope = { ...(sc.mode === "all" || sc.mode === "mine" ? { mode: sc.mode } : {}), ...(Array.isArray(sc.site_ids) ? { site_ids: sc.site_ids.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 100) } : {}) };
  }
  if (i.families && typeof i.families === "object") {
    const f = i.families as Record<string, unknown>;
    out.families = Object.fromEntries(FAMILIES[agent].filter((k) => typeof f[k] === "boolean").map((k) => [k, f[k] as boolean]));
  }
  // Never editable here:
  out.visibility = current.visibility;
  out.digest_optin = current.digest_optin;
  return { config: out, problems };
}

/** Add or remove one person from the digest list (their own switch). */
export function withDigest(current: AgentConfig, userId: string, on: boolean): AgentConfig {
  const set = new Set(current.digest_optin ?? []);
  if (on) set.add(userId); else set.delete(userId);
  return { ...current, digest_optin: [...set].slice(0, 200) };
}

// ── The tile's status chip ────────────────────────────────────────────────────────────────────────────────────────────────

export type TileStatusKey = "on" | "off" | "paused" | "needs_db" | "needs_setup" | "allowance" | "no_ai" | "no_timezone";
export type TileTone = "ok" | "muted" | "warn" | "bad";
export type TileStatus = { key: TileStatusKey; label: string; tone: TileTone };

export type TileInput = {
  engineReady: boolean;
  dbPending: boolean;
  enabled: boolean;
  paused: boolean;
  workspacePaused: boolean;
  platformStopped: boolean;
  aiConfigured: boolean;
  overCap: boolean;
  needsTimezone: boolean;
};

/** The one chip a tile shows. The order is the order of causes: a missing engine or database beats everything, then a stop, then Off. */
export function tileStatus(t: TileInput): TileStatus {
  if (!t.engineReady) return { key: "needs_setup", label: "Needs setup", tone: "warn" };
  if (t.dbPending) return { key: "needs_db", label: "Needs a database update", tone: "warn" };
  if (t.platformStopped || t.workspacePaused || t.paused) return { key: "paused", label: "Paused", tone: "warn" };
  // Off for want of a time zone is a setup step, not a choice: the tile says so (the agent cannot be switched on without one).
  if (!t.enabled && t.needsTimezone) return { key: "needs_setup", label: "Needs setup", tone: "warn" };
  if (!t.enabled) return { key: "off", label: "Off", tone: "muted" };
  if (t.needsTimezone) return { key: "no_timezone", label: "Set your time zone", tone: "warn" };
  if (!t.aiConfigured) return { key: "no_ai", label: "AI is not set up", tone: "bad" };
  if (t.overCap) return { key: "allowance", label: "Allowance reached", tone: "warn" };
  return { key: "on", label: "On", tone: "ok" };
}
