import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { tipTextProblems } from "@/lib/infoTip";
import { featureForObject } from "@/lib/objectFeatures";
import { PROJECT_TIPS } from "./tips";
import {
  approveProblem, isEditable, parseVariation, requestReason, revisionNote, submitProblem, variationCostLine, variationTotals, type VariationRow,
} from "./variations";
import {
  effectiveStatus, invoiceBody, invoiceProblem, milestoneAmount, milestoneTotals, parseMilestone, scheduleWarning, statusChangeProblem, type MilestoneRow,
} from "./milestones";
import { signedMoney } from "./format";

// After award (docs/design/gcc-tender-deals.md section 23): the pure rules of variations and invoicing milestones, the shape of
// migrations 0231 and 0232, and the promises of the bundle.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const strip = (sql: string) => lf(sql).replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

const variation = (over: Partial<VariationRow> = {}): VariationRow => ({
  id: "v1", project_id: "p1", ref: "VAR-0001", title: "Extra gate", description: null, status: "draft", amount: 5000, cost_amount: 3000, change_request_ref: null, note: null,
  submitted_by: null, submitted_at: null, decided_by: null, decided_at: null, budget_revision_id: null, created_by: "u1", created_at: "", updated_at: "", ...over,
});
const milestone = (over: Partial<MilestoneRow> = {}): MilestoneRow => ({
  id: "m1", project_id: "p1", title: "Advance", due_date: null, basis: "percent", percent: 30, fixed_amount: null, status: "planned", invoice_id: null, sort_order: 10, note: null,
  created_by: "u1", created_at: "", updated_at: "", ...over,
});

describe("variation input", () => {
  it("a new one needs a title; amounts may be negative; texts are cut, not refused", () => {
    expect(parseVariation({}, "create")).toMatchObject({ ok: false });
    expect(parseVariation({ title: "  " }, "create")).toMatchObject({ ok: false });
    const ok = parseVariation({ title: "Omit fence", amount: "-1200.456", cost_amount: -800, change_request_ref: "CR-7", description: "x".repeat(5000) }, "create");
    expect(ok).toMatchObject({ ok: true, value: { title: "Omit fence", amount: -1200.46, cost_amount: -800, change_request_ref: "CR-7" } });
    expect(ok.ok && ok.value.description).toHaveLength(2000);
  });

  it("a number that is not a number is refused; blank means zero", () => {
    expect(parseVariation({ title: "x", amount: "abc" }, "create")).toMatchObject({ ok: false });
    expect(parseVariation({ title: "x", cost_amount: 1e15 }, "create")).toMatchObject({ ok: false });
    expect(parseVariation({ title: "x", amount: "" }, "create")).toMatchObject({ ok: true, value: { amount: 0, cost_amount: 0 } });
  });

  it("an edit takes only what it names, and never the status, the ref or who", () => {
    const r = parseVariation({ amount: 10, status: "approved", ref: "VAR-9", submitted_by: "x", decided_by: "y", tenant_id: "t" }, "update");
    expect(r).toEqual({ ok: true, value: { amount: 10 } });
  });
});

describe("variation status rules", () => {
  it("a draft or rejected variation can be edited and sent; the others cannot", () => {
    expect(["draft", "rejected", "submitted", "approved"].map((s) => isEditable(s as VariationRow["status"]))).toEqual([true, true, false, false]);
    expect(submitProblem(variation())).toBeNull();
    expect(submitProblem(variation({ status: "rejected" }))).toBeNull();
    expect(submitProblem(variation({ status: "submitted" }))).toMatch(/already waiting/);
    expect(submitProblem(variation({ status: "approved" }))).toMatch(/cannot be sent again/);
    expect(submitProblem(variation({ amount: 0, cost_amount: 0 }))).toMatch(/change in contract value or the change in cost/);
  });

  it("only a waiting variation can be approved, and not into a negative contract value or on a closed project", () => {
    const open = { status: "active", contract_value: 10000 };
    expect(approveProblem(variation({ status: "submitted" }), open)).toBeNull();
    expect(approveProblem(variation({ status: "draft" }), open)).toMatch(/waiting for approval/);
    expect(approveProblem(variation({ status: "submitted", amount: -10001 }), open)).toMatch(/below zero/);
    expect(approveProblem(variation({ status: "submitted", amount: -10000 }), open)).toBeNull();
    expect(approveProblem(variation({ status: "submitted" }), { ...open, status: "closed" })).toMatch(/closed/);
  });
});

describe("variation totals", () => {
  it("the contract value already includes the approved ones; the original is the value less them", () => {
    const t = variationTotals([
      variation({ status: "approved", amount: 5000, cost_amount: 3000 }), variation({ id: "v2", status: "approved", amount: -1000, cost_amount: -600 }),
      variation({ id: "v3", status: "submitted", amount: 2500 }), variation({ id: "v4", status: "draft", amount: 99 }), variation({ id: "v5", status: "rejected", amount: 77 }),
    ], 104000);
    expect(t).toMatchObject({ count: 5, approved: 4000, approvedCost: 2400, pending: 2500, pendingCount: 1, revised: 104000, original: 100000 });
  });
});

describe("what an approval opens in the budget", () => {
  it("a cost increase adds one placeholder line; a cost reduction adds none and the note says to lower the lines", () => {
    const line = variationCostLine(variation(), "51");
    expect(line).toMatchObject({ resource_code: "51", qty: 1, unit_cost: 3000, cost_known: true, reserve: false });
    expect(line?.description).toContain("VAR-0001");
    expect(variationCostLine(variation({ cost_amount: -400 }), "51")).toBeNull();
    expect(variationCostLine(variation({ cost_amount: 0 }), "51")).toBeNull();
    expect(revisionNote(variation({ cost_amount: -400, change_request_ref: "CR-7" }))).toMatch(/CR-7.*lower the matching lines/);
    expect(revisionNote(variation({ title: "t".repeat(2000) })).length).toBeLessThanOrEqual(1000);
  });

  it("the request an approver reads says the ref, the money both ways and the change request", () => {
    expect(requestReason(variation({ change_request_ref: "CR-7" }), "SAR")).toBe("Variation VAR-0001 Extra gate, contract value +SAR 5,000, cost +SAR 3,000, change request CR-7");
    expect(signedMoney(-300, "SAR")).toBe("-SAR 300");
  });
});

describe("milestone input", () => {
  it("a percent milestone needs 0 to 100, a fixed one needs an amount; blank dates are allowed; the status and invoice are never read", () => {
    expect(parseMilestone({ title: "Advance", basis: "percent", percent: 30 }, "create")).toMatchObject({ ok: true, value: { title: "Advance", basis: "percent", percent: 30 } });
    expect(parseMilestone({ title: "Advance", percent: 30 }, "create")).toMatchObject({ ok: true, value: { basis: "percent", percent: 30 } });
    expect(parseMilestone({ title: "Advance", basis: "percent", percent: 120 }, "create")).toMatchObject({ ok: false });
    expect(parseMilestone({ title: "Advance", basis: "percent" }, "create")).toMatchObject({ ok: false });
    expect(parseMilestone({ title: "Mobilisation", basis: "fixed", fixed_amount: "15000" }, "create")).toMatchObject({ ok: true, value: { basis: "fixed", fixed_amount: 15000 } });
    expect(parseMilestone({ title: "Mobilisation", basis: "fixed", fixed_amount: -1 }, "create")).toMatchObject({ ok: false });
    expect(parseMilestone({ title: "", basis: "fixed", fixed_amount: 1 }, "create")).toMatchObject({ ok: false });
    expect(parseMilestone({ title: "x", basis: "percent", percent: 1, due_date: "31/12/2026" }, "create")).toMatchObject({ ok: false });
    expect(parseMilestone({ status: "paid", invoice_id: "x", project_id: "y", tenant_id: "z", note: "n" }, "update")).toEqual({ ok: true, value: { note: "n" } });
  });
});

describe("what a milestone bills", () => {
  it("a percent is of the contract value as it stands, a fixed amount is itself", () => {
    expect(milestoneAmount(milestone({ percent: 30 }), 100000)).toBe(30000);
    expect(milestoneAmount(milestone({ percent: 30 }), 104000)).toBe(31200);
    expect(milestoneAmount(milestone({ basis: "fixed", percent: null, fixed_amount: 15000 }), 104000)).toBe(15000);
  });

  it("a paid invoice makes it paid; a cancelled one makes it ready again", () => {
    expect(effectiveStatus(milestone({ status: "invoiced", invoice_id: "i" }), "paid")).toBe("paid");
    expect(effectiveStatus(milestone({ status: "invoiced", invoice_id: "i" }), "sent")).toBe("invoiced");
    expect(effectiveStatus(milestone({ status: "invoiced", invoice_id: "i" }), "cancelled")).toBe("ready");
    expect(effectiveStatus(milestone({ status: "planned" }), null)).toBe("planned");
  });

  it("a person moves it between planned and ready, and from invoiced to paid; invoiced only comes from the invoice", () => {
    expect(statusChangeProblem("planned", "ready")).toBeNull();
    expect(statusChangeProblem("ready", "planned")).toBeNull();
    expect(statusChangeProblem("invoiced", "paid")).toBeNull();
    expect(statusChangeProblem("planned", "invoiced")).toMatch(/create its invoice/);
    expect(statusChangeProblem("invoiced", "planned")).toMatch(/cannot go back/);
    expect(statusChangeProblem("planned", "paid")).toMatch(/not allowed/);
  });
});

describe("the billing schedule", () => {
  const rows = [
    { ...milestone({ percent: 30 }), invoice_status: null }, { ...milestone({ id: "m2", percent: 50, status: "invoiced", invoice_id: "i2" }), invoice_status: "sent" },
    { ...milestone({ id: "m3", basis: "fixed" as const, percent: null, fixed_amount: 10000, status: "invoiced", invoice_id: "i3" }), invoice_status: "paid" },
  ];

  it("adds up contracted, scheduled, invoiced, paid and what is still to invoice", () => {
    const t = milestoneTotals(rows, 100000);
    expect(t).toMatchObject({ contracted: 100000, scheduled: 90000, invoiced: 60000, paid: 10000, toInvoice: 40000, percentTotal: 80, count: 3, warning: null });
  });

  it("warns, and never blocks, when the percents pass 100 or the schedule passes the contract", () => {
    const over = milestoneTotals([{ ...milestone({ percent: 60 }), invoice_status: null }, { ...milestone({ id: "m2", percent: 60 }), invoice_status: null }], 100000);
    expect(over.warning).toBe("The percent milestones add up to 120%. They should total at most 100%");
    const money = milestoneTotals([{ ...milestone({ basis: "fixed", percent: null, fixed_amount: 120000 }), invoice_status: null }], 100000);
    expect(money.warning).toBe("The schedule adds up to more than the contract value");
    expect(scheduleWarning({ percentTotal: 100, scheduled: 100000, contracted: 100000 })).toBeNull();
  });
});

describe("the invoice a milestone makes", () => {
  const ok = { milestone: milestone(), invoiceStatus: null, amount: 30000, accountId: "a1", projectClosed: false };

  it("is offered for a planned or ready milestone with an amount, a customer and an open project", () => {
    expect(invoiceProblem(ok)).toBeNull();
    expect(invoiceProblem({ ...ok, milestone: milestone({ status: "ready" }) })).toBeNull();
    expect(invoiceProblem({ ...ok, accountId: null })).toMatch(/customer/);
    expect(invoiceProblem({ ...ok, amount: 0 })).toMatch(/no amount/);
    expect(invoiceProblem({ ...ok, projectClosed: true })).toMatch(/closed/);
    expect(invoiceProblem({ ...ok, milestone: milestone({ status: "invoiced", invoice_id: "i" }), invoiceStatus: "sent" })).toMatch(/already has an invoice/);
    expect(invoiceProblem({ ...ok, milestone: milestone({ status: "invoiced", invoice_id: "i" }), invoiceStatus: "cancelled" })).toBeNull();
  });

  it("is the body the invoices route takes: the project's customer, one line for the milestone, its due date, and where it came from", () => {
    const b = invoiceBody({ accountId: "a1", projectRef: "CPR-0001", projectName: "ARB-1 Fence", milestone: milestone({ due_date: "2026-12-01" }), amount: 30000 });
    expect(b).toMatchObject({ account_id: "a1", due_date: "2026-12-01", lines: [{ description: "Advance (CPR-0001 ARB-1 Fence)", qty: 1, rate: 30000, uom: "lot" }] });
    expect(b.notes).toBe("Contract project CPR-0001 ARB-1 Fence · milestone: Advance");
  });
});

describe("the explanations fit behind an i", () => {
  it("every tip is two sentences and 160 characters at most", () => {
    for (const [key, text] of Object.entries(PROJECT_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});

describe("migrations 0230, 0231 and 0232", () => {
  const files = { "0230": "0230_bid_version_cost_snapshot.sql", "0231": "0231_contract_project_variations.sql", "0232": "0232_contract_project_milestones.sql" };
  const sql = (n: keyof typeof files) => lf(read(`supabase/migrations/${files[n]}`));

  it("are idempotent", () => {
    for (const n of Object.keys(files) as (keyof typeof files)[]) {
      const code = strip(sql(n));
      for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `${n} create table ${m[2]}`).toBeTruthy();
      for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `${n} index ${m[3]}`).toBeTruthy();
      for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
      for (const m of code.matchAll(/create trigger (\w+)/gi)) expect(code, m[1]).toContain(`drop trigger if exists ${m[1]}`);
    }
  });

  it("every table has tenant_id and RLS on; the cost table has NO policy, the others a tenant SELECT policy and nothing that writes", () => {
    const cost = strip(sql("0230"));
    expect(cost).toMatch(/create table if not exists tender_bid_version_costs \([^;]*?tenant_id uuid not null references tenants\(id\)/);
    expect(cost).toMatch(/alter table tender_bid_version_costs enable row level security/);
    expect(cost).not.toMatch(/create policy/i);
    for (const [n, t] of [["0231", "contract_project_variations"], ["0232", "contract_project_milestones"]] as const) {
      const code = strip(sql(n));
      expect(code, t).toMatch(new RegExp(`create table if not exists ${t} \\([^;]*?tenant_id uuid not null references tenants\\(id\\)`));
      expect(code, t).toMatch(new RegExp(`alter table ${t} enable row level security`));
      const policies = [...code.matchAll(new RegExp(`create policy "([^"]+)" on ${t} for (\\w+)`, "gi"))];
      expect(policies, t).toHaveLength(1);
      expect(policies[0][2].toLowerCase()).toBe("select");
      expect(code, t).toMatch(new RegExp(`on ${t} for select using \\(tenant_id in \\(select tenant_id from tenant_users where user_id = auth\\.uid\\(\\)\\)\\)`));
      expect(code, t).not.toMatch(/for (all|insert|update|delete)/i);
    }
  });

  it("the cost of a bid version is written once (an UPDATE is refused) and is one row per version", () => {
    const code = strip(sql("0230"));
    expect(code).toMatch(/create trigger tender_bid_version_costs_immutable before update on tender_bid_version_costs/);
    expect(code).toMatch(/raise exception 'the cost of a submitted bid version cannot be changed'/);
    expect(code).toMatch(/unique \(opportunity_id, version_no\)/);
  });

  it("adds no column to any existing table", () => {
    for (const n of Object.keys(files) as (keyof typeof files)[]) expect(strip(sql(n))).not.toMatch(/alter table (?!\w+ enable row level security)/i);
  });

  it("variations have a ref index the ref generator recognises, a status check and signed amounts; milestones have a basis check and one invoice each", () => {
    const v = strip(sql("0231"));
    expect(v).toContain("contract_project_variations_tenant_ref_uniq");
    expect(v).toMatch(/status in \('draft', 'submitted', 'approved', 'rejected'\)/);
    expect(v).not.toMatch(/amount\s+numeric\(14,2\)\s+not null default 0 check/);
    const m = strip(sql("0232"));
    expect(m).toMatch(/status in \('planned', 'ready', 'invoiced', 'paid'\)/);
    expect(m).toMatch(/basis in \('percent', 'fixed'\)/);
    expect(m).toMatch(/create unique index if not exists contract_project_milestones_one_invoice on contract_project_milestones \(invoice_id\) where invoice_id is not null/);
    expect(m).toMatch(/percent >= 0 and percent <= 100/);
  });

  it("the bundle carries the three migrations verbatim, and the ledger lists them as pending", () => {
    const bundle = lf(read("scripts/run-bundle-41-after-award-2026-10-27.sql"));
    for (const n of Object.keys(files) as (keyof typeof files)[]) expect(bundle, n).toContain(sql(n).trim());
    const project = read("PROJECT.md");
    for (const f of Object.values(files)) expect(project, f).toContain(f);
    expect(project).toContain("run-bundle-41-after-award-2026-10-27.sql");
    expect(project).toMatch(/0230_bid_version_cost_snapshot\.sql -- PENDING/);
  });
});

describe("the gating map", () => {
  it("the new tables are owned by their modules", () => {
    expect(featureForObject("tender_bid_version_costs")).toBe("gcc_tender");
    expect(featureForObject("contract_project_variations")).toBe("contract_projects");
    expect(featureForObject("contract_project_milestones")).toBe("contract_projects");
  });

  it("variations have a VAR ref", () => {
    const src = read("src/lib/masterRef.ts");
    expect(src).toContain('"contract_project_variations"');
    expect(src).toContain('contract_project_variations: "VAR"');
  });
});

describe("the new routes", () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const routes = ["variations", "milestones"].flatMap((d) => walk(path.join(ROOT, "src/app/api/contract-projects/[id]", d)).filter((f) => /route\.ts$/.test(f)));

  it("every one starts with the project gate and never reads the workspace, the author or the status from the request", () => {
    expect(routes.length).toBe(6);
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("openProjectRequest(");
      expect(src, f).not.toMatch(/body\.tenant_id|body\.created_by|body\.submitted_by|body\.decided_by|body\.invoice_id|body\.project_id/);
    }
  });

  it("the contract value moves only in the approval, and nothing else writes it from a variation", () => {
    const server = read("src/lib/contractProjects/variationsServer.ts");
    expect(server.match(/\.update\(\{ contract_value/g)).toHaveLength(1);
    expect(server).toMatch(/\.eq\("contract_value", before\)/);
    for (const f of routes) expect(readFileSync(f, "utf8"), f).not.toMatch(/contract_value/);
  });

  it("the invoice is made by the existing invoices route, claimed first so a double click cannot make two", () => {
    const server = read("src/lib/contractProjects/milestonesServer.ts");
    expect(server).toMatch(/import\("@\/app\/api\/invoices\/route"\)/);
    expect(server.indexOf('status: "invoiced", invoice_id: null')).toBeLessThan(server.indexOf("import(\"@/app/api/invoices/route\")"));
    expect(server).not.toMatch(/from\("invoices"\)\s*\.insert/);
  });

  it("every control of the new screens carries a data-guide id the assistant can point at", () => {
    const files = ["VariationsTab.tsx", "VariationPanel.tsx", "InvoicingTab.tsx", "MilestonePanel.tsx", "ProjectOriginCards.tsx"].map((f) => read(`src/components/contractProjects/${f}`));
    const ids = new Set(files.flatMap((s) => [...s.matchAll(/"(cp\.[a-z_.]+)"/g)].map((m) => m[1])));
    for (const id of [
      "cp.variations", "cp.variation.add", "cp.variation.save", "cp.variation.send", "cp.variation.approve", "cp.variation.reject", "cp.variation.withdraw", "cp.variation.remove",
      "cp.invoicing", "cp.milestone.add", "cp.milestone.save", "cp.milestone.create_invoice", "cp.milestone.remove", "cp.milestone.copy_terms", "cp.bidvs",
    ]) expect(ids, id).toContain(id);
  });
});
