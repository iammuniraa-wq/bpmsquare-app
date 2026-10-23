import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({}) }));

import { SALES_ORDER_LIST_COLUMNS, SALES_ORDER_DETAIL_EXTRA, SALES_ORDER_LINE_COLUMNS, shapeSalesOrderRow, shapeSalesOrderLine } from "./salesOrderRows";
import { LIST_SOURCES } from "./listSources";
import { UNDOCUMENTED_ENDPOINTS } from "./registry";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const cols = (s: string) => s.split(",").map((c) => c.trim());

// bpmsquarecore 3b-5: internal columns stay internal, on every machine surface. Orders carry no cost or margin field, but
// the creator, the cancellation note and a party's contact details are not for customers or integrations.
describe("sales orders on the machine surfaces", () => {
  const banned = ["created_by", "owner_user_id", "cancel_reason", "tenant_id", "template", "rules"];

  it("selects no internal column", () => {
    const all = [SALES_ORDER_LIST_COLUMNS, SALES_ORDER_DETAIL_EXTRA, SALES_ORDER_LINE_COLUMNS].flatMap(cols);
    for (const b of banned) expect(all, b).not.toContain(b);
    for (const c of all) expect(c).not.toMatch(/cost|margin|supplier/i);
  });

  it("never selects *, on the shared loader or the v1 routes", () => {
    for (const f of ["src/lib/api/salesOrderRows.ts", "src/app/api/v1/sales-orders/route.ts", "src/app/api/v1/sales-orders/[id]/route.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\.select\(\s*["'`]\*["'`]/);
      for (const b of banned) expect(src.match(new RegExp(`\\.select\\([^)]*${b}`)), `${f}: ${b}`).toBeNull();
    }
  });

  it("returns a contact as an id only and a party as name and address only", () => {
    const row = shapeSalesOrderRow({
      id: "o1", ref: "SO-0001", status: "confirmed", account_id: "a1", contact_id: "c1", accounts: { id: "a1", name: "Acme" },
      ship_to: { name: "Site 4", address: "Industrial Area", contact: "Sam Jones", phone: "+974 5555 1234", email: "sam@x.com", tax_id: "T-1" },
    });
    expect(row).toMatchObject({ contact_id: "c1", account: { id: "a1", name: "Acme" }, ship_to: { name: "Site 4", address: "Industrial Area" } });
    expect(JSON.stringify(row)).not.toMatch(/Sam Jones|5555|sam@x\.com|T-1/);
  });

  it("shapes a header and drops anything unexpected", () => {
    const row = shapeSalesOrderRow(
      { id: "o1", ref: "SO-0001", status: "confirmed", total: 1180, account_id: "a1", sales_order_types: [{ id: "ty1", name: "Standard order" }], custom_data: { cf_x: 1 }, created_at: "t0", updated_at: "t1", created_by: "u1", cancel_reason: "why", owner_user_id: "u2" },
      3,
    );
    expect(row).toMatchObject({ id: "o1", total: 1180, line_count: 3, type: { id: "ty1", name: "Standard order" }, custom_data: { cf_x: 1 }, _links: { self: "/api/v1/sales-orders/o1", account: "/api/v1/accounts/a1" } });
    for (const k of ["created_by", "cancel_reason", "owner_user_id", "tenant_id"]) expect(row).not.toHaveProperty(k);
  });

  it("shapes a line with its availability and where it came from", () => {
    const line = shapeSalesOrderLine({ id: "l1", line_no: 1, description: "Pump", qty: 2, unit_price: 50, line_total: 100, confirmed_qty: 2, confirmed_date: "2026-07-01", availability_source: "master", tenant_id: "t1" });
    expect(line).toMatchObject({ id: "l1", unit_price: 50, confirmed_date: "2026-07-01", availability_source: "master", discount_pct: 0 });
    expect(line).not.toHaveProperty("tenant_id");
  });

  it("is a list source (so /ask and the report builder can reach it), a documented v1 endpoint and has no explicit-only scope", () => {
    expect(LIST_SOURCES.sales_orders.relatedWorkcenter).toBe("sales_orders");
    expect(LIST_SOURCES.sales_orders.fields.map((f) => f.path)).toEqual(expect.arrayContaining(["ref", "status", "total", "account.name", "expected_date"]));
    expect(UNDOCUMENTED_ENDPOINTS).toContain("/api/v1/sales-orders");
    expect(read("src/app/api/v1/_auth.ts")).not.toMatch(/EXPLICIT_SCOPE_ONLY[^\n]*sales_orders/);
  });
});
