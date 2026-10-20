// Who is next in turn. Pure.

/**
 * The member after `lastAssigned` in a stable order; the first member when
 * nobody has been assigned yet. If the last person has since left the team,
 * the next id in order after theirs. Null for an empty team.
 */
export function nextInRotation(memberIds: readonly string[], lastAssigned: string | null | undefined): string | null {
  const ids = [...new Set(memberIds)].sort();
  if (ids.length === 0) return null;
  if (!lastAssigned) return ids[0];
  const i = ids.indexOf(lastAssigned);
  if (i === -1) return ids.find((id) => id > lastAssigned) ?? ids[0];
  return ids[(i + 1) % ids.length];
}
