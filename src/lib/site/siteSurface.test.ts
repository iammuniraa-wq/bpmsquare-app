import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { tipTextProblems } from "@/lib/infoTip";
import { SITE_TIPS } from "./tips";
import { standingBars } from "./standingBars";
import { evidenceProblem, pathBelongsTo, siteConfig, sniffEvidence } from "./files";
import { normaliseRead } from "./readReceipt";
import { REGISTER_COLUMNS, buildRegisterWorkbook, safeCell } from "./register";
import { cleanCategory, cleanSiteSettings } from "./settingsRules";
import { OBJECT_FEATURE } from "@/lib/objectFeatureMap";
import { featureForObject } from "@/lib/objectFeatures";
import { FIELD_REGISTRY } from "@/lib/fieldRegistry";
import { SETTINGS_MENU } from "@/lib/settingsMenu";
import { NAV } from "@/lib/constants";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("the explanations stay behind the i", () => {
  it("every tip fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(SITE_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});

describe("the migrations have no member write path (WFM and 0199 lessons)", () => {
  const sql = (n: string) => read(`supabase/migrations/${readdirSync(path.join(ROOT, "supabase/migrations")).find((f) => f.startsWith(n))!}`).replace(/--[^\n]*/g, "");
  const policies = (text: string) => [...text.matchAll(/create policy "([^"]+)" on (\w+)\s+for (\w+)/gi)].map((m) => ({ name: m[1], table: m[2], cmd: m[3].toLowerCase() }));
  const tables = (text: string) => [...text.matchAll(/create table if not exists (\w+)/gi)].map((m) => m[1]);

  it.each(["0258", "0259"])("%s: every table has RLS on and only SELECT policies", (n) => {
    const text = sql(n);
    for (const t of tables(text)) expect(text, `${t} RLS`).toMatch(new RegExp(`alter table ${t} enable row level security`, "i"));
    const list = policies(text);
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) expect(p.cmd, `${p.table}: ${p.name}`).toBe("select");
    expect(text).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("every table carries tenant_id and a tenant condition in its policy", () => {
    for (const n of ["0258", "0259"]) {
      const text = sql(n);
      for (const t of tables(text)) expect(text, t).toMatch(new RegExp(`create table if not exists ${t} \\([^;]*tenant_id\\s+uuid not null references tenants\\(id\\)`, "i"));
    }
  });

  it("the evidence bucket is private and has no storage policy", () => {
    const text = sql("0258");
    expect(text).toMatch(/'site-evidence', 'site-evidence', false/);
    expect(text).not.toMatch(/on storage\.objects/i);
  });

  it("the bundles are the migrations, wrapped in one transaction", () => {
    for (const [bundle, n] of [["run-bundle-site-0258-expenses-2026-11-24.sql", "0258"], ["run-bundle-site-0259-receipts-2026-11-24.sql", "0259"], ["run-bundle-site-0260-site-entry-2026-11-24.sql", "0260"]]) {
      const b = read(`scripts/${bundle}`);
      expect(b).toMatch(/\nbegin;\n/);
      expect(b.trimEnd().endsWith("commit;")).toBe(true);
      const mig = read(`supabase/migrations/${readdirSync(path.join(ROOT, "supabase/migrations")).find((f) => f.startsWith(n))!}`);
      expect(b).toContain(mig.trim().split("\n").filter((l) => !l.startsWith("--")).slice(0, 6).join("\n"));
    }
  });
});

describe("hidden by default", () => {
  it("both modules are off for a new workspace and own their objects", () => {
    const form = read("src/app/admin/tenants/new/NewTenantForm.tsx");
    expect(form).toMatch(/site_receipts: false/);
    expect(form).toMatch(/site_expenses: false/);
    for (const k of ["site_expenses", "site-expenses"]) expect(OBJECT_FEATURE[k]).toBe("site_expenses");
    for (const k of ["site_receipts", "site-receipts"]) expect(OBJECT_FEATURE[k]).toBe("site_receipts");
    expect(featureForObject("site_expenses")).toBe("site_expenses");
  });

  it("the platform admin can switch them on, and the nav item needs a flag", () => {
    expect(read("src/app/admin/tenants/[id]/TenantEditor.tsx")).toMatch(/key: "site_expenses"/);
    const site = NAV.flatMap((g) => g.items.flatMap((i) => i.children ?? [i])).find((i) => i.label === "Site");
    expect(site?.featureAnyOf).toEqual(["site_receipts", "site_expenses"]);
  });

  it("the two objects are in the registry and the settings page needs a flag", () => {
    expect(FIELD_REGISTRY.site_expense.fields.every((f) => f.exportOnly === true)).toBe(true);
    expect(FIELD_REGISTRY.site_receipt.fields.every((f) => f.exportOnly === true)).toBe(true);
    expect(SETTINGS_MENU.find((m) => m.id === "site")).toMatchObject({ adminOnly: true, featureAnyOf: ["site_receipts", "site_expenses"] });
  });

  it("every site route opens through the gate or the admin check, never an ungated read", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else if (e.name === "route.ts") out.push(p);
      }
      return out;
    };
    const routes = [...walk(path.join(ROOT, "src/app/api/site-expenses")), ...walk(path.join(ROOT, "src/app/api/site-receipts")), ...walk(path.join(ROOT, "src/app/api/site")), ...walk(path.join(ROOT, "src/app/api/settings/site"))];
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) {
      const text = readFileSync(r, "utf8");
      expect(/openSiteRequest\(|requireTenantUser\(|guard\(\)/.test(text), r).toBe(true);
      expect(text, r).not.toMatch(/request\.json\(\)[^;]*tenant_id/);
    }
  });
});

describe("evidence files", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  it("are known by their bytes, not their name", () => {
    expect(sniffEvidence(jpeg)).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(sniffEvidence(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))?.ext).toBe("pdf");
    expect(sniffEvidence(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
    expect(evidenceProblem({ name: "x.jpg", size: 10 }, new Uint8Array([1, 2, 3]))).not.toBeNull();
    expect(evidenceProblem({ name: "x.jpg", size: 10 }, jpeg)).toBeNull();
    expect(evidenceProblem({ name: "x.jpg", size: 9 * 1024 * 1024 }, jpeg)).toMatch(/8 MB/);
    expect(evidenceProblem({ name: "s.pdf", size: 10 }, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { imageOnly: true })).not.toBeNull();
  });
  it("a path is only the workspace's own", () => {
    expect(pathBelongsTo("t1", "t1/site_expense/x/y.jpg")).toBe(true);
    expect(pathBelongsTo("t1", "t2/site_expense/x/y.jpg")).toBe(false);
    expect(pathBelongsTo("t1", "t1/../t2/x.jpg")).toBe(false);
  });
});

describe("settings", () => {
  it("reads the config defensively", () => {
    expect(siteConfig(null)).toEqual({ pm_limit: null, monthly_cap: null, notify_receipts: [] });
    expect(siteConfig({ site: { pm_limit: -5, monthly_cap: "x", notify_receipts: ["a", "a", 3] } })).toEqual({ pm_limit: null, monthly_cap: null, notify_receipts: ["a"] });
    expect(siteConfig({ site: { pm_limit: 1000 } }).pm_limit).toBe(1000);
  });
  it("validates what an admin saves", () => {
    expect(cleanSiteSettings({ pm_limit: "", monthly_cap: 5000 })).toMatchObject({ ok: true, value: { pm_limit: null, monthly_cap: 5000 } });
    expect(cleanSiteSettings({ pm_limit: -1 })).toMatchObject({ ok: false });
    expect(cleanCategory({ name: " " }, false)).toMatchObject({ ok: false });
    expect(cleanCategory({ active: false }, true)).toEqual({ ok: true, value: { active: false } });
  });
});

describe("the budget line bar", () => {
  it("never counts a figure twice and flags an overspend", () => {
    const b = standingBars({ budget: 1000, committed: 600, posted: 100, recorded_others: 300, this_one: 200 });
    expect(b.used).toBe(600);
    expect(b.left).toBe(400);
    expect(b.over).toBe(0);
    expect(b.segments.map((s) => s.key)).toEqual(["posted", "recorded", "this"]);
    const over = standingBars({ budget: 500, committed: null, posted: null, recorded_others: 400, this_one: 300 });
    expect(over).toMatchObject({ over: 200, left: -200 });
    expect(over.segments.reduce((s, x) => s + x.pct, 0)).toBeLessThanOrEqual(100.1);
    expect(standingBars({ budget: null, committed: null, posted: null, recorded_others: 0, this_one: 0 }).left).toBeNull();
  });
});

describe("the photo reader's proposal is made safe", () => {
  it("parses numbers, drops a bad date and a category that is not on the list, and never keeps a VAT above the total", () => {
    const r = normaliseRead({ total: "SAR 1,412.50", currency: "sar", date: "2026-02-31", vendor: "  Al Rashid ", vat_amount: "5000", invoice_ref: "88213", category: "Transport", note: "" }, ["Materials", "Transport"]);
    expect(r).toMatchObject({ amount: 1412.5, currency: "SAR", expense_date: null, vendor_text: "Al Rashid", vat_amount: null, invoice_ref: "88213", category_name: "Transport" });
    expect(normaliseRead({ category: "Gold plating" }, ["Materials"]).category_name).toBeNull();
    expect(normaliseRead("junk", []).amount).toBeNull();
    expect(normaliseRead({ total: "-5" }, []).amount).toBeNull();
  });
});

describe("the register for finance", () => {
  it("carries our reference first and neutralises formulas", async () => {
    expect(REGISTER_COLUMNS[0].header).toBe("Document reference");
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    const buf = await buildRegisterWorkbook([{ ref: "SEX-0001", project_ref: "CPR-1", project_name: "P", expense_date: "2026-11-20", category: "Transport", erp_category: "51", resource_code: "51", cost_code: null, wbs_code: null, cost_line: null, vendor: "=cmd|' /C calc'!A0", invoice_ref: null, currency: "SAR", amount: 10, amount_project_ccy: 10, vat_amount: null, paid_by: "Company", document_state: "Receipt attached", submitted_by: "A", approved_by: "B", approved_at: null, note: null }], { generated: "2026-11-24", tenantName: "PCBS" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Site expenses")!;
    expect(sheet.getRow(3).getCell(1).value).toBe("SEX-0001");
    expect(String(sheet.getRow(3).getCell(11).value).startsWith("'=")).toBe(true);
  });
});
