import { describe, it, expect, vi, beforeEach } from "vitest";

// scope.ts is server-only and reaches the database, so both are stubbed. The
// point of these tests is the TREE WALK and the resulting visibility set --
// the part that decides whether a site supervisor can see another site's
// people, which no test covered before.
vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

/** Minimal stand-in for the Supabase query builder, for the exact chain
 * scope.ts uses: from(t).select(c).eq(...).in(...) awaited as { data }. */
function fakeAdmin(tables: {
  employees: Row[];
  wfm_sites: Row[];
  wfm_roster_assignments: Row[];
}) {
  return {
    from(table: keyof typeof tables) {
      const filters: { col: string; vals: unknown[]; kind: "eq" | "in" | "gte" | "lte" }[] = [];
      const builder = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push({ col, vals: [val], kind: "eq" }); return builder; },
        in(col: string, vals: unknown[]) { filters.push({ col, vals, kind: "in" }); return builder; },
        gte(col: string, val: unknown) { filters.push({ col, vals: [val], kind: "gte" }); return builder; },
        lte(col: string, val: unknown) { filters.push({ col, vals: [val], kind: "lte" }); return builder; },
        maybeSingle() {
          const rows = apply();
          return Promise.resolve({ data: rows[0] ?? null });
        },
        then(resolve: (v: { data: Row[] }) => unknown) {
          return Promise.resolve({ data: apply() }).then(resolve);
        },
      };
      function apply(): Row[] {
        return tables[table].filter((row) =>
          filters.every((f) => {
            if (f.col === "tenant_id") return true; // single-tenant fixture
            const v = row[f.col];
            if (f.kind === "eq") return v === f.vals[0];
            if (f.kind === "in") return f.vals.includes(v);
            if (f.kind === "gte") return String(v) >= String(f.vals[0]);
            return String(v) <= String(f.vals[0]);
          })
        );
      }
      return builder;
    },
  };
}

let fixture: Parameters<typeof fakeAdmin>[0];

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => fakeAdmin(fixture),
}));

const { resolveWfmScope, canApproveFor } = await import("./scope");

// Three sites, three supervisors, one manager over them — the client's shape.
//   Arun (manager)
//     ├── Priya  → Site A → Ravi, Sunil
//     ├── Kiran  → Site B → Meena
//     └── Latha  → Site C → (nobody)
const ARUN = "arun", PRIYA = "priya", KIRAN = "kiran", LATHA = "latha";
const RAVI = "ravi", SUNIL = "sunil", MEENA = "meena";
const SITE_A = "siteA", SITE_B = "siteB", SITE_C = "siteC";

beforeEach(() => {
  fixture = {
    employees: [
      { id: ARUN, supervisor_id: null, site_id: null, wfm_role: "supervisor", status: "active" },
      { id: PRIYA, supervisor_id: ARUN, site_id: null, wfm_role: "supervisor", status: "active" },
      { id: KIRAN, supervisor_id: ARUN, site_id: null, wfm_role: "supervisor", status: "active" },
      { id: LATHA, supervisor_id: ARUN, site_id: null, wfm_role: "supervisor", status: "active" },
      { id: RAVI, supervisor_id: null, site_id: SITE_A, wfm_role: "employee", status: "active" },
      { id: SUNIL, supervisor_id: null, site_id: SITE_A, wfm_role: "employee", status: "active" },
      { id: MEENA, supervisor_id: null, site_id: SITE_B, wfm_role: "employee", status: "active" },
    ],
    wfm_sites: [
      { id: SITE_A, supervisor_id: PRIYA, name: "Site A" },
      { id: SITE_B, supervisor_id: KIRAN, name: "Site B" },
      { id: SITE_C, supervisor_id: LATHA, name: "Site C" },
    ],
    wfm_roster_assignments: [],
  };
});

const ctxFor = (id: string, role: "admin" | "member" = "member") => ({
  tenantId: "t1",
  role,
  employee: { id, wfm_role: "supervisor" } as never,
  isSupervisor: true,
});

describe("resolveWfmScope", () => {
  it("gives a site supervisor their own site only", async () => {
    const scope = await resolveWfmScope(ctxFor(PRIYA));
    expect(scope.unrestricted).toBe(false);
    expect(new Set(scope.employeeIds)).toEqual(new Set([RAVI, SUNIL]));
    expect(scope.employeeIds).not.toContain(MEENA); // Site B is not hers
  });

  it("never includes the supervisor themselves — that's what blocks self-approval", async () => {
    const scope = await resolveWfmScope(ctxFor(PRIYA));
    expect(scope.employeeIds).not.toContain(PRIYA);
  });

  it("gives a manager every site beneath them, plus their supervisors", async () => {
    const scope = await resolveWfmScope(ctxFor(ARUN));
    expect(new Set(scope.employeeIds)).toEqual(
      new Set([PRIYA, KIRAN, LATHA, RAVI, SUNIL, MEENA])
    );
    expect(scope.employeeIds).not.toContain(ARUN);
  });

  it("gives a tenant admin an unrestricted scope", async () => {
    const scope = await resolveWfmScope(ctxFor(ARUN, "admin"));
    expect(scope.unrestricted).toBe(true);
    expect(scope.employeeIds).toBeNull();
  });

  it("gives a plain employee only themselves", async () => {
    const scope = await resolveWfmScope({
      tenantId: "t1", role: "member",
      employee: { id: RAVI } as never, isSupervisor: false,
    });
    expect(scope.employeeIds).toEqual([RAVI]);
  });

  it("follows a roster assignment onto another supervisor's site", async () => {
    // Meena normally belongs to Site B, but is rostered to Priya's Site A.
    fixture.wfm_roster_assignments = [
      { employee_id: MEENA, site_id: SITE_A, date: "2026-08-12" },
    ];
    const scope = await resolveWfmScope(ctxFor(PRIYA), { from: "2026-08-01", to: "2026-08-31" });
    expect(scope.employeeIds).toContain(MEENA);
  });

  it("survives a cycle in the supervisor chain without hanging", async () => {
    fixture.employees = [
      { id: "a", supervisor_id: "b", site_id: null, status: "active" },
      { id: "b", supervisor_id: "a", site_id: null, status: "active" },
    ];
    fixture.wfm_sites = [];
    const scope = await resolveWfmScope(ctxFor("a"));
    expect(scope.employeeIds).toEqual(["b"]);
  });
});

describe("canApproveFor", () => {
  it("lets a site supervisor approve their own site's employee", async () => {
    expect(await canApproveFor(ctxFor(PRIYA), RAVI, "2026-08-12")).toEqual({ ok: true });
  });

  it("refuses a supervisor at a different site", async () => {
    const r = await canApproveFor(ctxFor(PRIYA), MEENA, "2026-08-12");
    expect(r.ok).toBe(false);
  });

  it("lets the manager approve anyone beneath them, including a supervisor", async () => {
    expect(await canApproveFor(ctxFor(ARUN), RAVI, "2026-08-12")).toEqual({ ok: true });
    expect(await canApproveFor(ctxFor(ARUN), PRIYA, "2026-08-12")).toEqual({ ok: true });
  });

  it("refuses self-approval, even for a tenant admin", async () => {
    const own = await canApproveFor(ctxFor(PRIYA), PRIYA, "2026-08-12");
    expect(own.ok).toBe(false);
    const adminOwn = await canApproveFor(ctxFor(ARUN, "admin"), ARUN, "2026-08-12");
    expect(adminOwn.ok).toBe(false);
  });

  it("follows the roster: authority is the site worked on THAT date", async () => {
    fixture.wfm_roster_assignments = [
      { employee_id: MEENA, site_id: SITE_A, date: "2026-08-12" },
    ];
    // On the rostered day Meena is Priya's; on any other day she is Kiran's.
    expect(await canApproveFor(ctxFor(PRIYA), MEENA, "2026-08-12")).toEqual({ ok: true });
    expect((await canApproveFor(ctxFor(PRIYA), MEENA, "2026-08-13")).ok).toBe(false);
  });

  it("explains itself when the site has no supervisor", async () => {
    fixture.wfm_sites = [{ id: SITE_A, supervisor_id: null, name: "Site A" }];
    const r = await canApproveFor(ctxFor(KIRAN), RAVI, "2026-08-12");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no supervisor/i);
  });
});
