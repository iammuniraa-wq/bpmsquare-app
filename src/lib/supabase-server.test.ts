import { describe, it, expect } from "vitest";
import { shouldBlockForPasswordChange } from "./supabase-server";

// Regression coverage for the API-layer must_change_password gate
// (requireTenantUser()). Before this gate existed, the flag was only
// enforced by (app)/layout.tsx -- which never runs for route handlers --
// so a still-must-change-password session had full working API access.
// This pure function is the actual decision requireTenantUser() applies;
// exercising it directly here catches a regression (e.g. someone widening
// the exempt set, or inverting the boolean) without needing a live DB/request.
describe("shouldBlockForPasswordChange", () => {
  it("does not block when the flag is false, regardless of path", () => {
    expect(shouldBlockForPasswordChange(false, "/api/quotes")).toBe(false);
    expect(shouldBlockForPasswordChange(false, "/api/auth/complete-password-change")).toBe(false);
  });

  it("blocks any ordinary API route when the flag is true", () => {
    expect(shouldBlockForPasswordChange(true, "/api/quotes")).toBe(true);
    expect(shouldBlockForPasswordChange(true, "/api/wfm/employees/bulk-shift")).toBe(true);
    expect(shouldBlockForPasswordChange(true, "/api/business-users")).toBe(true);
  });

  it("never blocks the one exempt path -- the flow can't clear its own gate otherwise", () => {
    expect(shouldBlockForPasswordChange(true, "/api/auth/complete-password-change")).toBe(false);
  });

  it("does not exempt a path that merely starts with the exempt one", () => {
    // Guards against a future refactor loosening this to startsWith() and
    // accidentally exempting a whole subtree.
    expect(shouldBlockForPasswordChange(true, "/api/auth/complete-password-change/extra")).toBe(true);
  });

  it("treats an empty/unset pathname as blocked, not exempt", () => {
    // PATHNAME_HEADER can be missing/empty; that must fail closed (blocked),
    // never silently match the exempt set.
    expect(shouldBlockForPasswordChange(true, "")).toBe(true);
  });
});
