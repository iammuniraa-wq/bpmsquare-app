import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { withNewWorkspaceDefaults } from "@/lib/moduleDependencies";
import { normalisePlan } from "./tenantStudio";

// Owner decision 2026-11-22: web research comes on by default for NEW workspaces with the AI assistant. It must never reach
// an existing workspace: only the two ways of creating one call the default, and no migration or seed touches a tenant.

describe("withNewWorkspaceDefaults", () => {
  it("turns web research on with the assistant", () => {
    expect(withNewWorkspaceDefaults({ ai_assistant: true })).toEqual({ ai_assistant: true, ai_assistant_web: true });
    expect(withNewWorkspaceDefaults({ ai_assistant: true, ai_assistant_web: true })).toMatchObject({ ai_assistant_web: true });
  });
  it("keeps it off when asked to (an explicit false, or an opt-out)", () => {
    expect(withNewWorkspaceDefaults({ ai_assistant: true, ai_assistant_web: false }).ai_assistant_web).toBe(false);
    expect(withNewWorkspaceDefaults({ ai_assistant: true }, true).ai_assistant_web).toBe(false);
  });
  it("keeps the dependency: without the assistant there is no web research, and no key appears from nowhere", () => {
    expect(withNewWorkspaceDefaults({ ai_assistant: false, ai_assistant_web: true }).ai_assistant_web).toBe(false);
    expect(withNewWorkspaceDefaults({ ai_assistant_web: true }).ai_assistant_web).toBe(false);
    expect(withNewWorkspaceDefaults({ accounts: true })).toEqual({ accounts: true });
  });
  it("changes nothing else and does not mutate its input", () => {
    const input = { ai_assistant: true, accounts: true, wfm: false };
    const out = withNewWorkspaceDefaults(input);
    expect(input).toEqual({ ai_assistant: true, accounts: true, wfm: false });
    expect(out).toEqual({ ai_assistant: true, accounts: true, wfm: false, ai_assistant_web: true });
  });
});

describe("the tenant studio's plan", () => {
  const plan = (features: Record<string, unknown>) => normalisePlan({ tenant: { name: "Acme", slug: "acme", custom_domain: "acme.bpmsquare.com" }, features });

  it("a client with the AI assistant gets web research on, and the plan says so", () => {
    const { plan: p, warnings } = plan({ accounts: true, ai_assistant: true });
    expect(p.features).toMatchObject({ ai_assistant: true, ai_assistant_web: true });
    expect(warnings.join(" ")).toMatch(/Web research is on by default/);
  });

  it("a plan that says no keeps it off", () => {
    const { plan: p } = plan({ accounts: true, ai_assistant: true, ai_assistant_web: false });
    expect(p.features.ai_assistant_web).toBe(false);
  });

  it("a client without the assistant gets neither, and saying yes to web research alone adds nothing", () => {
    expect(plan({ accounts: true }).plan.features).not.toHaveProperty("ai_assistant_web");
    expect(plan({ accounts: true, ai_assistant_web: true }).plan.features).not.toHaveProperty("ai_assistant_web");
  });

  it("every other experimental flag is still refused", () => {
    const { plan: p, warnings } = plan({ ai_assistant: true, next_experience: true, ai_assistant_actions: true });
    expect(p.features).not.toHaveProperty("next_experience");
    expect(p.features).not.toHaveProperty("ai_assistant_actions");
    expect(warnings.join(" ")).toMatch(/Ignored "next_experience"/);
  });
});

describe("no existing workspace is touched", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

  it("the new-tenant form starts with web research on and applies the default on submit", () => {
    const form = read("src/app/admin/tenants/new/NewTenantForm.tsx");
    expect(form).toMatch(/ai_assistant: false, ai_assistant_web: true/);
    expect(form).toContain("features: withNewWorkspaceDefaults(features)");
  });

  it("only the form and the studio's plan call the default", () => {
    // git grep also sees the files this work has added but not yet committed (they are untracked, so --untracked).
    const out = execFileSync("git", ["grep", "--untracked", "-l", "withNewWorkspaceDefaults", "--", "src"], { cwd: root, encoding: "utf8" });
    const callers = out.split(/\r?\n/).map((f) => f.trim()).filter((f) => f && !/\.test\.ts$/.test(f));
    expect(callers.sort()).toEqual(["src/app/admin/tenants/new/NewTenantForm.tsx", "src/lib/admin/tenantStudio.ts", "src/lib/moduleDependencies.ts"]);
  });

  it("the tenant editor and the update route (the paths an existing workspace goes through) never use it", () => {
    for (const rel of ["src/app/admin/tenants/[id]/TenantEditor.tsx", "src/app/api/admin/tenants/[id]/route.ts"]) {
      expect(read(rel), rel).not.toContain("withNewWorkspaceDefaults");
    }
  });

  it("the report needs no migration and no seed: it caches in company_analyses and flips no tenant's flag", () => {
    const names = [...readdirSync(path.join(root, "supabase/migrations")), ...readdirSync(path.join(root, "scripts"))];
    expect(names.filter((n) => /^0249|company[-_]report/i.test(n))).toEqual([]);
  });
});
