import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({}) }));
vi.mock("@/lib/wfm/server", () => ({
  requireWfmSupervisor: async () => ({ tenantId: "t1" }),
  getWfmConfig: async () => ({
    employment_types: [{ code: "employee", label: "Employee" }, { code: "intern", label: "Intern" }],
  }),
}));
vi.mock("@/lib/wfm/bootstrap", () => ({ wfmEmployeesPayload: async () => [] }));
vi.mock("@/lib/employeeRef", () => ({ generateNextEmployeeCode: async () => "EMP-0001", isEmployeeCodeCollision: () => false }));
vi.mock("@/lib/wfm/scope", () => ({ resolveWfmScope: async () => ({ unrestricted: true }), filterEmployeesToScope: (x: unknown) => x }));

const { POST } = await import("@/app/api/wfm/employees/route");

describe("creating an employee with a type the workspace has not set up", () => {
  it("names the allowed types and where to add one, instead of 'Invalid employment_type'", async () => {
    const res = await POST(new Request("http://x/api/wfm/employees", {
      method: "POST",
      body: JSON.stringify({ first_name: "Asha", employment_type: "trainee" }),
    }) as never);
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toBe("Employment type 'trainee' is not set up. Add it in Settings > Workforce or use one of: Employee (employee), Intern (intern).");
  });
});

describe("no route is left with the bare message", () => {
  it("both employee routes build the message from the workspace's own list", () => {
    for (const f of ["src/app/api/wfm/employees/route.ts", "src/app/api/wfm/employees/[id]/route.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("Invalid employment_type");
      expect(src, f).toContain("employmentTypeError(");
    }
  });
});
