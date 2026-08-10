import { describe, it, expect } from "vitest";
import { shouldApplyRoles } from "./businessUsers";

// Regression coverage for POST /api/business-users' role-grant guard.
// findOrCreateUserForInvite()'s email lookup is project-wide, not
// tenant-scoped -- isNew: false means the submitted email already had a
// Supabase Auth account somewhere on the platform, and nobody has confirmed
// that account's owner wants it linked to this tenant. Business Roles must
// never be granted to it in the same request; this function is the actual
// gate the route applies.
describe("shouldApplyRoles", () => {
  it("applies roles for a genuinely new account with roles requested", () => {
    expect(shouldApplyRoles(true, ["role-1"])).toBe(true);
  });

  it("never applies roles when linking a pre-existing account, even if role_ids were sent", () => {
    expect(shouldApplyRoles(false, ["role-1", "role-2"])).toBe(false);
  });

  it("is a no-op either way when no roles were requested", () => {
    expect(shouldApplyRoles(true, [])).toBe(false);
    expect(shouldApplyRoles(false, [])).toBe(false);
  });
});
