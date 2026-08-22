// Pure punch-gate rules — no server or DB imports, so the punch screen and
// the punch route both import the SAME function rather than each carrying
// its own copy of "which kinds need a selfie". Two copies of this rule
// drifting apart is how a client blocks something the server accepts, or
// worse, the other way round.

import type { WfmConfig } from "@/lib/constants";
import type { PresenceKind } from "./types";

/** Shift punches: the two that bound a working day. */
export function isShiftPunch(kind: PresenceKind): boolean {
  return kind === "check_in" || kind === "check_out";
}

function isBreakPunch(kind: PresenceKind): boolean {
  return kind === "break_start" || kind === "break_end";
}

/**
 * Which punch kinds the location mandate (require_location, or
 * geofence_mode "block") applies to: shift punches AND breaks — owner
 * decision 2026-08-20, after BIM asked for breaks to be location-gated
 * too. OT and mobile-work/business-trip punches stay exempt: they happen
 * off-site or after hours where demanding a fix would strand people, and
 * (for breaks-vs-OT symmetry arguments) OT is supervisor-approved anyway.
 */
export function locationRequiredFor(kind: PresenceKind): boolean {
  return isShiftPunch(kind) || isBreakPunch(kind);
}

/**
 * Does this punch kind need a selfie under the tenant's setting?
 *
 *  off   — never. For a tenant that doesn't want punch photographs at all
 *          (a real DPDP-driven ask; before this setting existed a selfie
 *          was mandatory with no way to decline).
 *  shift — check in / check out AND breaks, plus the start of mobile work
 *          and a business trip.
 *  all   — every punch kind (overtime included).
 *
 * Breaks were selfie-exempt in every mode until 2026-08-22 (the original
 * 2026-08-20 reasoning: a camera stop four times a day is friction with no
 * fraud it could catch, since breaks only reduce payable time). Reversed by
 * owner decision 2026-08-22: a break punch must look and behave exactly
 * like a shift punch, so the employee sees one consistent flow rather than
 * a camera that appears for some buttons and not others. Only "off" now
 * exempts a break.
 */
export function selfieRequiredFor(kind: PresenceKind, mode: WfmConfig["selfie_mode"]): boolean {
  if (mode === "off") return false;
  if (mode === "all") return true;
  return isShiftPunch(kind) || isBreakPunch(kind)
    || kind === "mobile_work_start" || kind === "business_trip_start";
}
