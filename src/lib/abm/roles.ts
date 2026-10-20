import { REQUIRABLE_ROLES, ROLE_LABEL, isRole, type AbmRole } from "./types";

// The buying group rule: a program says which roles a target needs filled
// (default decision maker + influencer); a target "has a gap" for each
// required role nobody holds. Pure, so the grid, the progress rule and the
// Account 360 card all read the same answer.

export type GroupMember = { id: string; role: AbmRole; is_primary: boolean };

export type RoleGap = { role: AbmRole; text: string };

/** Keeps only roles a program may require, in a stable order, deduplicated. Falls back to the default when none survive. */
export function sanitizeRequiredRoles(input: unknown, fallback: AbmRole[]): AbmRole[] {
  if (!Array.isArray(input)) return fallback;
  const picked = REQUIRABLE_ROLES.filter((r) => input.includes(r) && isRole(r));
  return picked.length > 0 ? [...picked] : fallback;
}

/** Required roles that no member holds. */
export function missingRoles(required: readonly AbmRole[], members: readonly Pick<GroupMember, "role">[]): AbmRole[] {
  const held = new Set(members.map((m) => m.role));
  return required.filter((r) => !held.has(r));
}

const GAP_TEXT: Partial<Record<AbmRole, string>> = {
  decision_maker: "No decision maker yet",
  influencer: "No influencer yet",
  user: "No user named yet",
};

export function roleGaps(required: readonly AbmRole[], members: readonly Pick<GroupMember, "role">[]): RoleGap[] {
  return missingRoles(required, members).map((role) => ({ role, text: GAP_TEXT[role] ?? `No ${ROLE_LABEL[role].toLowerCase()} yet` }));
}

/** One line for list rows: "3 people · no decision maker", "2 people", "No one named yet". */
export function groupSummary(required: readonly AbmRole[], members: readonly Pick<GroupMember, "role">[]): { text: string; hasGap: boolean } {
  const gaps = roleGaps(required, members);
  const people = members.length === 0 ? "No one named yet" : `${members.length} ${members.length === 1 ? "person" : "people"}`;
  if (gaps.length === 0) return { text: people, hasGap: false };
  const gapText = gaps.map((g) => g.text.replace(/^No /, "no ").replace(/ yet$/, "")).join(", ");
  return { text: members.length === 0 ? `${people} · ${gapText}` : `${people} · ${gapText}`, hasGap: true };
}

/** The member who should be called first: the primary, else the first decision maker, else the first person. */
export function pickPrimary<T extends GroupMember>(members: readonly T[]): T | null {
  return members.find((m) => m.is_primary) ?? members.find((m) => m.role === "decision_maker") ?? members[0] ?? null;
}
