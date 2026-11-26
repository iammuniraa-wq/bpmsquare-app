import type { ConnState, ErpKind, Num, Reading } from "./types";

// States (design section 5). Not connected is a state, never a zero: a figure that needs the ERP read-back is `null` with the words "Not
// connected" until a good pull has landed, and a real 0 ("nothing posted yet") only after a pull that returned no rows.

/** One row of project_erp_state (migration 0262): did a pull ever succeed, when, and how many rows it held. */
export type ErpKindState = {
  kind: ErpKind;
  linked: boolean;
  last_ok_at: string | null;
  last_status: "ok" | "failed" | null;
  row_count: number;
};

const DAY = 86_400_000;

/**
 * The state of one kind of fact. No row, a project not linked, or a kind never pulled successfully is Not connected. A failed LAST run with
 * an earlier good pull keeps that pull's number and says so; with none it is still Not connected (there is no number to keep).
 */
export function connectionState(s: ErpKindState | null | undefined, now: Date, freshnessDays: number): { state: ConnState; asOf: string | null } {
  if (!s || !s.linked || !s.last_ok_at) return { state: "not_connected", asOf: null };
  const asOf = s.last_ok_at;
  if (s.last_status === "failed") return { state: "failed", asOf };
  if (s.row_count === 0) return { state: "nothing_posted", asOf };
  const age = now.getTime() - new Date(asOf).getTime();
  return { state: Number.isFinite(age) && age > freshnessDays * DAY ? "stale" : "live", asOf };
}

/** Does this state carry a number a person may read? Everything but Not connected does (a real 0 included). */
export const hasNumber = (state: ConnState): boolean => state !== "not_connected";

/** A reading: the value when the state allows one, else null. The one place a missing connection is turned into "nothing to show". */
export function reading(state: ConnState, asOf: string | null, value: Num): Reading {
  return hasNumber(state) ? { state, value, asOf } : { state: "not_connected", value: null, asOf: null };
}

/** The words under a figure: "as of 23 Nov", "as of 17 Nov, stale", "nothing posted yet", "last pull failed", or the next step. */
export function stateNote(state: ConnState, asOf: string | null, nextStep = "Connect the ERP cost read-back"): string {
  const when = asOf ? new Date(asOf).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : null;
  switch (state) {
    case "live": return when ? `as of ${when}` : "";
    case "stale": return when ? `as of ${when}, out of date` : "out of date";
    case "nothing_posted": return "nothing posted yet";
    case "failed": return when ? `last pull failed, showing ${when}` : "last pull failed";
    default: return nextStep;
  }
}

/** The worst of several states, for a figure built from more than one kind: any Not connected wins, then failed, stale, nothing posted, live. */
export function worstState(states: readonly ConnState[]): ConnState {
  for (const s of ["not_connected", "failed", "stale", "nothing_posted"] as const) if (states.includes(s)) return s;
  return "live";
}
