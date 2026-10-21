// Why a lead went to the person it did, in plain words. Pure and client-safe.

export const ASSIGNMENT_WORDS: Record<string, string> = {
  team_lead: "Team lead of the owning team",
  round_robin: "Next in turn on the owning team",
  fallback_list: "No coverage matched, so it went to the next person on your hand-over list",
  fallback_admin: "No coverage matched, so an admin has it",
  unassigned: "Nobody yet: no coverage matched and no admin was found",
  manual: "Set by hand",
  claimed: "Picked up by the salesperson",
};

/** Reasons that mean "the routing did not find a team", shown as a warning chip. */
export const ASSIGNMENT_GAPS = new Set(["fallback_admin", "unassigned"]);
