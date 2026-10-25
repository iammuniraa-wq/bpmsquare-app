import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { tipTextProblems } from "@/lib/infoTip";
import { RFQ_TIPS } from "./tips";
import { rfqConfig } from "./types";
import { tenderRfqLines } from "@/lib/tender/rfqLines";

// GCC tender deals, slice 3b: the shape of migration 0224, the bundle that carries it, the ledger, the gating map, the
// explanations behind the "i", the controls the assistant can point at, and the tender-only entry point.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(read("supabase/migrations/0224_rfq_awards.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const TABLES = ["rfq_line_awards", "product_suppliers"];

describe("migration 0224", () => {
  it("is idempotent", () => {
    for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `create table ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `index ${m[3]}`).toBeTruthy();
    for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
  });

  it("every table has tenant_id, RLS and a tenant SELECT policy and NOTHING that writes (a member must not forge or erase an award)", () => {
    for (const t of TABLES) {
      expect(code, t).toMatch(new RegExp(`create table if not exists ${t} \\([^;]*?tenant_id uuid not null references tenants\\(id\\)`));
      expect(code, t).toMatch(new RegExp(`alter table ${t} enable row level security`));
      const policies = [...code.matchAll(new RegExp(`create policy "([^"]+)" on ${t} for (\\w+)`, "gi"))];
      expect(policies, t).toHaveLength(1);
      expect(policies[0][2].toLowerCase()).toBe("select");
      expect(code, t).toMatch(new RegExp(`on ${t} for select using \\(tenant_id in \\(select tenant_id from tenant_users where user_id = auth\\.uid\\(\\)\\)\\)`));
    }
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("one standing award per line, a reason whenever the price was not the lowest, and a changed award supersedes rather than rewrites", () => {
    expect(code).toMatch(/create unique index if not exists rfq_line_awards_one_current on rfq_line_awards \(rfq_line_id\) where superseded_at is null/);
    expect(code).toMatch(/check \(not not_lowest or reason is not null\)/);
    expect(code).toMatch(/char_length\(reason\) between 3 and 1000/);
    for (const col of ["chosen_by", "chosen_at", "not_lowest", "superseded_at", "superseded_by", "applied_to_deal_at", "landed_unit", "lowest_valid_unit"]) expect(code, col).toContain(col);
  });

  it("one supplier price per product and supplier, and adds no column to any existing table (opportunity_lines above all)", () => {
    expect(code).toMatch(/unique \(tenant_id, product_id, supplier_id\)/);
    const altered = [...code.matchAll(/alter table (?:if exists )?(\w+)/gi)].map((m) => m[1]);
    expect(altered.length).toBeGreaterThan(0);
    for (const t of altered) expect(TABLES, `alter table ${t}`).toContain(t);
  });

  it("the bundle carries the migration verbatim, and the ledger lists it as pending", () => {
    const bundle = lf(read("scripts/run-bundle-34-rfq-awards-2026-10-26.sql"));
    expect(bundle).toContain(sql.trim());
    const project = read("PROJECT.md");
    expect(project).toMatch(/0224_rfq_awards\.sql/);
    expect(project).toMatch(/run-bundle-34-rfq-awards-2026-10-26\.sql/);
  });
});

describe("gating and wiring", () => {
  it("the new tables are owned by a module", () => {
    expect(featureForObject("rfq_line_awards")).toBe("rfq");
    expect(featureForObject("product_suppliers")).toBe("products");
  });

  it("the stale-price limit is a workspace setting with a sane default and bounds", () => {
    expect(rfqConfig(undefined).price_valid_days).toBe(180);
    expect(rfqConfig({ price_valid_days: 5 }).price_valid_days).toBe(30);
    expect(rfqConfig({ price_valid_days: 9999 }).price_valid_days).toBe(730);
    expect(rfqConfig({ price_valid_days: 90 }).price_valid_days).toBe(90);
  });

  it("the explanations fit behind an i", () => {
    for (const [key, text] of Object.entries(RFQ_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });

  it("every control of the comparison and award carries a data-guide id the assistant can point at", () => {
    const files = ["src/components/rfq/RfqCompare.tsx", "src/components/rfq/TenderLinesRfq.tsx", "src/components/rfq/SupplierPicker.tsx", "src/app/(app)/settings/rfq/RfqSettingsClient.tsx"];
    const ids = new Set(files.flatMap((f) => [...read(f).matchAll(/"(rfq\.[a-z_.0-9]+)"/g)].map((m) => m[1])).concat(read("src/components/rfq/RfqCompare.tsx").includes("rfq.compare.supplier.${") ? ["rfq.compare.supplier.N"] : []));
    const tender = read("src/components/rfq/TenderLinesRfq.tsx");
    expect(tender).toContain('guideId="tender.lines.rfq"');
    for (const id of ["rfq.compare", "rfq.compare.legend", "rfq.compare.award", "rfq.compare.award_all", "rfq.compare.no_award", "rfq.compare.enter_reply", "rfq.award.reason", "rfq.award.fx", "rfq.award.confirm", "rfq.award.cancel", "rfq.award.pending", "rfq.deal.apply", "rfq.deal.confirm", "rfq.suppliers.type", "rfq.settings.stale_days", "rfq.compare.supplier.N"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("the request button on the deal's Lines tab is mounted only for a tender deal in a workspace with the RFQ module", () => {
    const page = lf(read("src/app/(app)/pipeline/[id]/page.tsx"));
    expect(page).toMatch(/tenderRfq=\{tender && rfqOn \?/);
    const client = lf(read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx"));
    // The deal page hands the tender's toolbar the RFQ lines only when it has them; the toolbar is the one place the button is drawn.
    expect(client).toMatch(/rfq=\{tenderRfq \? \{ opportunityId: opp\.id/);
    expect(lf(read("src/components/tender/TenderLinesToolbar.tsx"))).toMatch(/\{rfq && <TenderLinesRfq /);
  });

  it("the supplier-type filter is off unless a caller turns it on", () => {
    const picker = read("src/components/rfq/SupplierPicker.tsx");
    expect(picker).toMatch(/\{typeFilter && \(/);
    expect(picker).toMatch(/!typeFilter \|\| kind === "all"/);
    for (const f of ["src/components/rfq/RfqComposer.tsx", "src/components/rfq/RfqDialog.tsx", "src/components/rfq/CreateRfqButton.tsx"]) expect(read(f), f).toContain("supplierTypeFilter");
    expect(read("src/components/rfq/RecordRfqsCard.tsx")).not.toContain("supplierTypeFilter");
  });
});

describe("the tender RFQ lines", () => {
  const lines = [
    { id: "d1", description: "Pipe 6in", uom: "m", qty: 120, rate: 0, sl_no: "3.1.2", product_id: "p1" },
    { id: "d2", description: "Flange", uom: "Nos", qty: 8, rate: 0, sl_no: "3.1.3" },
    { id: "d3", description: "Priced already", uom: "Nos", qty: 1, rate: 50, sl_no: "" },
    { id: "d4", description: "On another RFQ", uom: "Nos", qty: 1, rate: 0, sl_no: "4", rfq_line_id: "rl-9" },
    { id: "d5", description: "Break row", uom: "Nos", qty: 1, rate: 0, sl_no: "5", break_of: "d1" },
  ];
  const out = tenderRfqLines(lines, (rl) => (rl === "rl-9" ? "RFQ-0002" : null));

  it("carries the client's item number as the line's reference, ticks the lines still without a price, and names the ones already asked", () => {
    expect(out.map((l) => l.source_line_id)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(out[0]).toMatchObject({ product_id: "p1", description: "Pipe 6in", qty: 120, uom: "m", spec: "Item no. 3.1.2", include: true });
    expect(out[1]).toMatchObject({ spec: "Item no. 3.1.3", include: true });
    expect(out[2].spec ?? null).toBeNull(); // no item number to carry
    expect(out[2].include).toBe(false); // priced while others are not
    expect(out[3]).toMatchObject({ include: false, linked_ref: "RFQ-0002" });
  });
});
