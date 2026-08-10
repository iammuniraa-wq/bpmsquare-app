/**
 * Pure decision function for whether POST /api/business-users may apply the
 * submitted role_ids in the same request. Split out from the route so the
 * security-relevant branch (never grant roles to a pre-existing, unverified
 * account) can be unit-tested directly -- see businessUsers.test.ts.
 *
 * isNew: false means findOrCreateUserForInvite() matched an ALREADY-existing
 * Supabase Auth account (a project-wide lookup, not tenant-scoped) rather
 * than creating one with the admin-supplied password. Nobody has confirmed
 * that account's owner wants it linked to this tenant, so it must not also
 * walk away with live Business Roles from the same request -- role
 * assignment for a linked account has to go through the normal follow-up
 * role-assignment action instead, same as Settings -> Team already requires.
 */
export function shouldApplyRoles(isNew: boolean, roleIds: string[]): boolean {
  return isNew && roleIds.length > 0;
}
