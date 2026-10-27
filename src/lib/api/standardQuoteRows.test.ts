import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({}) }));

import {
  STANDARD_QUOTE_LIST_COLUMNS, STANDARD_QUOTE_DETAIL_EXTRA, STANDARD_QUOTE_LINE_COLUMNS, STANDARD_QUOTE_LINE_BASE_COLUMNS,
  shapeStandardQuoteRow, shapeStandardQuoteLine,
} from "./standardQuoteRows";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const cols = (s: string) => s.split(",").map((c) => c.trim());

// The guardrail result on a line holds the real margin against the floor, and the RFQ link points at
// what a line costs us. Every machine surface selects explicit columns, so the protection is the
// absence of the name from those selects -- this pins it (bpmsquarecore 3b-5, internal columns).
describe("standard quotes on the machine surfaces", () => {
  const banned = ["pricing_flags", "pricing_document_id", "rfq_line_id", "template_id", "created_by", "print_options", "tenant_id"];

  it("selects no internal, pricing-guardrail or cost column", () => {
    const all = [STANDARD_QUOTE_LIST_COLUMNS, STANDARD_QUOTE_DETAIL_EXTRA, STANDARD_QUOTE_LINE_COLUMNS, STANDARD_QUOTE_LINE_BASE_COLUMNS].flatMap(cols);
    for (const b of banned) expect(all, b).not.toContain(b);
    for (const c of all) expect(c).not.toMatch(/cost|margin|supplier/i);
  });

  it("never selects *, on the shared loader or the v1 routes", () => {
    for (const f of ["src/lib/api/standardQuoteRows.ts", "src/app/api/v1/standard-quotes/route.ts", "src/app/api/v1/standard-quotes/[id]/route.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\.select\(\s*["'`]\*["'`]/);
      for (const b of banned) expect(src.match(new RegExp(`\\.select\\([^)]*${b}`)), `${f}: ${b}`).toBeNull();
    }
  });

  it("returns a contact as an id only", () => {
    expect(STANDARD_QUOTE_LIST_COLUMNS).toContain("contact_id");
    const row = shapeStandardQuoteRow({ id: "q1", ref: "SQ-2026-0001", status: "draft", account_id: "a1", contact_id: "c1", contacts: { name: "Sam", email: "s@x.com" }, accounts: { id: "a1", name: "Acme" } });
    expect(row).toMatchObject({ contact_id: "c1", account: { id: "a1", name: "Acme" } });
    expect(JSON.stringify(row)).not.toMatch(/Sam|s@x\.com/);
  });

  it("shapes a header and drops anything unexpected", () => {
    const row = shapeStandardQuoteRow(
      { id: "q1", ref: "SQ-2026-0001", status: "sent", total: 1180, subtotal: 1000, tax_pct: 18, account_id: "a1", accounts: [{ id: "a1", name: "Acme" }], custom_data: { cf_x: 1 }, created_at: "t0", updated_at: "t1", pricing_flags: [{ code: "MARGIN_FLOOR" }], created_by: "u1" },
      3
    );
    expect(row).toMatchObject({
      id: "q1", ref: "SQ-2026-0001", status: "sent", total: 1180, tax_pct: 18, line_count: 3,
      custom_data: { cf_x: 1 }, _links: { self: "/api/v1/standard-quotes/q1", account: "/api/v1/accounts/a1" },
    });
    for (const k of ["pricing_flags", "created_by", "tenant_id", "template_id"]) expect(row).not.toHaveProperty(k);
  });

  it("a missing 0209 column reads as no custom values, and a header without lines has no line_count key", () => {
    const row = shapeStandardQuoteRow({ id: "q2", status: "draft" });
    expect(row.custom_data).toBeNull();
    expect(row).not.toHaveProperty("line_count");
  });

  it("shapes a line without its pricing state", () => {
    const line = shapeStandardQuoteLine({ id: "l1", description: "Pump", qty: 2, rate: 50, amount: 100, pricing_flags: [{ code: "MARGIN_FLOOR", actual_pct: 4 }], pricing_document_id: "d1", rfq_line_id: "r1" });
    expect(line).toMatchObject({ id: "l1", description: "Pump", qty: 2, amount: 100, is_selected: true, show_on_pdf: true });
    for (const k of ["pricing_flags", "pricing_document_id", "rfq_line_id"]) expect(line).not.toHaveProperty(k);
  });
});
