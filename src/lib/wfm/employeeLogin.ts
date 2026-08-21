// Employee-code login (client decision 2026-08-21). Some tenants don't want
// their workers' personal email addresses used as logins (PagarBook never
// asked for one). In "code" login mode an employee signs in with their
// employee code + a password instead. Supabase Auth still needs an email, so
// we mint a DETERMINISTIC synthetic address from (tenantId, code) and use it
// as the account's email under the hood -- the worker never sees or needs it.
//
// This module is deliberately PURE (no server-only, no db, no crypto): the
// pre-auth login form constructs exactly the same address the admin-create
// route stored, so signing in by code needs no lookup and no "does this code
// exist" oracle -- a wrong code simply produces an address no account matches,
// which fails the password step generically like any bad login.

// A reserved domain that can never receive real mail, so a synthetic address
// can neither collide with a real inbox nor be mistaken for one. `.local` is
// reserved (RFC 6762) and never routable.
export const EMPLOYEE_LOGIN_DOMAIN = "employee.bpmsquare.local";

/** Lowercased, email-local-part-safe slug of an employee code. Empty when the
 *  code has no usable alphanumerics (the caller must treat that as "can't mint
 *  a code login for this employee"). */
export function employeeCodeSlug(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Deterministic synthetic login email for an employee who signs in by code.
 * Globally unique: employee_code is unique per tenant (0057) and the tenant
 * id is unique, so `<code-slug>.<tenantId>` can't collide across tenants.
 * Returns null when the code has no usable slug.
 */
export function employeeSyntheticEmail(tenantId: string, code: string | null | undefined): string | null {
  if (!code) return null;
  const slug = employeeCodeSlug(code);
  if (!slug) return null;
  return `emp-${slug}.${tenantId}@${EMPLOYEE_LOGIN_DOMAIN}`;
}

/** True for an address minted by employeeSyntheticEmail (vs a person's real
 *  email) -- used to render "signs in by employee code" instead of an address,
 *  and to keep synthetic addresses out of anything that emails a human. */
export function isEmployeeSyntheticEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.endsWith(`@${EMPLOYEE_LOGIN_DOMAIN}`);
}

/**
 * A human-friendly default User ID from a name: "vani.iyer". Lowercased,
 * only [a-z0-9.], the login handle the employee types. The synthetic email is
 * still derived from it (employeeSyntheticEmail slugs the dots to dashes), so
 * typing the User ID at login reconstructs the same address the create route
 * stored. The admin can override the suggestion; the route dedupes it.
 */
export function suggestUsername(first: string | null | undefined, last?: string | null): string {
  const clean = (s: string) => (s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const base = [clean(first ?? ""), clean(last ?? "")].filter(Boolean).join(".");
  return base || "user";
}

/** Normalise an admin-typed or generated User ID to the stored/handle form. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9.]+/g, ".").replace(/\.+/g, ".").replace(/^\.|\.$/g, "");
}
