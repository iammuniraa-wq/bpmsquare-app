// The explanations the ABM screens keep behind an "i" (docs/design/ux-simplification.md §3 rows 9 and 10). One
// place, so a test can hold every text to the InfoTip limit (two sentences, 160 characters). The screens never
// print these; they pass them to InfoTip.

import { PROGRESS_LABEL } from "./types";

export const ABM_TIPS = {
  buyingGroup: "Roles are for this program only. Open the account to add a contact that is not listed.",
  person: "Naming someone sends nothing and needs no consent.",
  tier: "How much personal attention a company gets. 1:1 is worked personally, 1:few as a small cluster, 1:many with the program's standard plays.",
  deal: "Linking a deal moves the company to Deal open, and to Won or Lost when the deal closes.",
  note: "Only people in your workspace see this. It never goes out through the API.",
  updateProgress: "The rules only move a company forward. Use this to set what only a person can know, or to correct it.",
  reason: "Kept with your name and the date.",
  kind: "New business wins companies you do not serve yet. Expansion grows companies you already serve.",
  programOwner: "Owns the program. Each company's own owner comes from Coverage.",
  goal: "One plain sentence, for example: Win 3 precast supply contracts with Riyadh residential developers.",
  defaultTier: "A company can be moved to another tier later.",
  requiredRoles: `A company with none of a required role shows a gap. By default it is not marked ${PROGRESS_LABEL.engaged} until the gap is filled.`,
  source: "The list is copied into the program once and never changes by itself. You can add or remove companies by hand afterwards.",
  smallSample: "Fewer than 20 targets. Read the results as a list, not a trend.",
} as const;

/** Where this company's owner came from, for the "i" on the Owner field. */
export function ownerTip(source: "coverage" | "program" | "manual", unchanged: boolean): string {
  if (source === "coverage" && unchanged) return "Set from Coverage. Change it to override for this program only.";
  if (source === "manual") return "Chosen by hand for this program.";
  return "From the program owner, as no Coverage rule matched this company.";
}

/** The "Copied list" chip: which kind of list, and when it was copied. */
export function copiedListTip(fromGroup: boolean, date: string): string {
  return `Copied from ${fromGroup ? "a marketing target group" : "a Coverage segment"} on ${date}. It does not change by itself.`;
}

/** The "i" on the Results card: where the money comes from, and where dropped and lost companies are counted. */
export function resultsTip(dropped: number, lost: number): string {
  const base = "Money is from the deals linked to targets.";
  return dropped > 0 || lost > 0 ? `${base} ${dropped} dropped and ${lost} lost count in Targets, not in the steps after.` : base;
}
