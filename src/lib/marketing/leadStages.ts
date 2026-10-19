// The eight plain lead stages (docs/marketing-platform-architecture.md 4.2)
// and how they relate to the six values leads.status has always held.
// Pure and client-safe.
//
// leads.status is untouched and remains what the existing screens read and
// write. A stage is derived from it until a lead goes through the new flow,
// and when it does, `status` is kept in step through legacyStatusForStage(),
// so the Vikas leads list never sees a value it does not know.

export const LEAD_STAGES = [
  { key: "new", code: "NEW", label: "New", hint: "Just arrived; nobody has looked at it yet." },
  { key: "engaged", code: "ENGAGED", label: "Engaged", hint: "Showing real interest, not yet ready for a call." },
  { key: "ready", code: "READY", label: "Ready for sales", hint: "Interested enough that a salesperson should call now." },
  { key: "working", code: "WORKING", label: "Working", hint: "A salesperson has accepted it and is following up." },
  { key: "deal", code: "DEAL", label: "Deal", hint: "Turned into a deal in the pipeline." },
  { key: "customer", code: "CUSTOMER", label: "Customer", hint: "Bought from us." },
  { key: "not_now", code: "NOT_NOW", label: "Not now", hint: "Not the right time; comes back if they show interest again." },
  { key: "not_fit", code: "NOT_FIT", label: "Not a fit", hint: "We will not pursue this one." },
] as const;

export type LeadStageKey = (typeof LEAD_STAGES)[number]["key"];
export type LeadStageCode = (typeof LEAD_STAGES)[number]["code"];

export const LEAD_STAGE_KEYS: readonly LeadStageKey[] = LEAD_STAGES.map((s) => s.key);

export function isLeadStageKey(v: unknown): v is LeadStageKey {
  return typeof v === "string" && (LEAD_STAGE_KEYS as readonly string[]).includes(v);
}

export function stageDefOf(key: LeadStageKey) {
  return LEAD_STAGES.find((s) => s.key === key)!;
}

/** Today's six values -> the eight stages (the migration mapping in section 4.2). */
const LEGACY_TO_STAGE: Record<string, LeadStageKey> = {
  new: "new",
  inspecting: "working",
  quoted: "working",
  converted: "deal",
  won: "customer",
  lost: "not_now",
};

export function stageForLegacyStatus(status: string | null | undefined): LeadStageKey {
  return LEGACY_TO_STAGE[status ?? ""] ?? "new";
}

/** The legacy value to keep leads.status at when a lead is moved to a stage. */
const STAGE_TO_LEGACY: Record<LeadStageKey, string> = {
  new: "new",
  engaged: "new",
  ready: "new",
  working: "inspecting",
  deal: "converted",
  customer: "won",
  not_now: "lost",
  not_fit: "lost",
};

export function legacyStatusForStage(stage: LeadStageKey): string {
  return STAGE_TO_LEGACY[stage];
}

/**
 * The stage a lead is in. `customStage` is the key of the lead's
 * custom_status, when it has one. If the old status column has since been
 * moved by an older screen (the convert route sets "converted") so that it no
 * longer agrees with the stored stage, the old column is the more recent
 * truth and wins.
 */
export function effectiveLeadStage(lead: { status: string | null | undefined }, customStage?: LeadStageKey | null): LeadStageKey {
  if (customStage && legacyStatusForStage(customStage) === (lead.status ?? "new")) return customStage;
  return stageForLegacyStatus(lead.status);
}
