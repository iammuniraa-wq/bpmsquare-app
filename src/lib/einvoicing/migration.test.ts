import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const raw = readFileSync(path.join(root, "supabase/migrations/0219_einvoicing_data.sql"), "utf8");
const sql = raw.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("migration 0219 (Saudi e-invoicing data)", () => {
  it("only adds: every new column is nullable, added if not exists, and there is no drop or rename", () => {
    const adds = [...sql.matchAll(/add column if not exists (\w+) ([^,;]*)/gi)];
    expect(adds.length).toBe(8 + 7 + 3);
    for (const [, name, rest] of adds) {
      expect(rest, name).not.toMatch(/not null/i);
      expect(rest, name).not.toMatch(/\bdefault\b/i);
    }
    expect(sql).not.toMatch(/drop (column|table)/i);
    expect(sql).not.toMatch(/rename /i);
    expect(sql).not.toMatch(/alter column/i);
  });

  it("has the columns the code reads", () => {
    for (const col of ["vat_number", "crn", "name_ar", "buyer_type", "address_building", "address_district", "buyer_id_number", "buyer_id_scheme"]) expect(sql).toContain(`add column if not exists ${col} `);
    for (const col of ["einvoice_doc_type", "einvoice_uuid", "einvoice_seq", "einvoice_unit", "original_invoice_id", "credit_reason", "supply_date"]) expect(sql).toContain(`add column if not exists ${col} `);
    for (const col of ["vat_category", "vat_rate", "vat_exemption_reason"]) expect(sql).toContain(`add column if not exists ${col} `);
    // issued_at already exists on invoices; adding it again would be a second source of truth
    expect(sql).not.toMatch(/add column if not exists issued_at/i);
  });

  it("the category, type and rate columns carry their checks", () => {
    expect(sql).toMatch(/vat_category text check \(vat_category in \('S', 'Z', 'E', 'O'\)\)/);
    expect(sql).toMatch(/einvoice_doc_type text check \(einvoice_doc_type in \('standard', 'simplified', 'credit_note', 'debit_note'\)\)/);
    expect(sql).toMatch(/buyer_type text check \(buyer_type in \('business', 'individual'\)\)/);
    expect(sql).toMatch(/vat_rate numeric\(5,2\) check/);
  });

  it("the counter table has RLS and a tenant SELECT policy and nothing that writes", () => {
    expect(sql).toMatch(/alter table einvoice_counters enable row level security/);
    const policies = [...sql.matchAll(/create policy "([^"]+)" on einvoice_counters for (\w+)/gi)];
    expect(policies).toHaveLength(1);
    expect(policies[0][2].toLowerCase()).toBe("select");
    expect(sql).toMatch(/using \(tenant_id in \(select tenant_id from tenant_users where user_id = auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/tenant_id uuid not null references tenants\(id\)/);
  });

  it("no policy is created on the existing tables (their member policies are unchanged)", () => {
    const tables = [...sql.matchAll(/create policy "[^"]+" on (\w+)/gi)].map((m) => m[1]);
    expect(tables).toEqual(["einvoice_counters"]);
  });

  it("only the service role may take a number", () => {
    expect(sql).toMatch(/revoke all on function allocate_einvoice_seq\(uuid, uuid, text\) from public/);
    expect(sql).toMatch(/revoke all on function allocate_einvoice_seq\(uuid, uuid, text\) from anon, authenticated/);
    expect(sql).toMatch(/grant execute on function allocate_einvoice_seq\(uuid, uuid, text\) to service_role/);
  });

  it("the guard freezes the UUID and counter and keeps a member from setting the counter", () => {
    expect(sql).toMatch(/old\.einvoice_uuid is not null and new\.einvoice_uuid is distinct from old\.einvoice_uuid/);
    expect(sql).toMatch(/old\.einvoice_seq is not null and \(new\.einvoice_seq is distinct from old\.einvoice_seq/);
    expect(sql).toMatch(/v_role <> 'service_role' and old\.einvoice_seq is null and new\.einvoice_seq is not null/);
    expect(sql).toMatch(/create trigger invoices_einvoice_guard before insert or update on invoices/);
  });

  it("the counter is unique per tenant, seller unit and number", () => {
    expect(sql).toMatch(/create unique index if not exists invoices_einvoice_seq_uniq on invoices \(tenant_id, coalesce\(einvoice_unit, ''\), einvoice_seq\)/);
  });

  it("is plain ASCII so the SQL editor takes it as is", () => {
    expect([...raw].filter((ch) => ch.charCodeAt(0) > 127)).toEqual([]);
  });

  it("the bundle carries the migration verbatim", () => {
    const bundle = readFileSync(path.join(root, "scripts/run-bundle-30-einvoicing-data-2026-10-25.sql"), "utf8");
    expect(bundle.replace(/\r\n/g, "\n")).toContain(raw.replace(/\r\n/g, "\n").trim());
  });

  it("is on the PROJECT.md ledger as pending", () => {
    const ledger = readFileSync(path.join(root, "PROJECT.md"), "utf8");
    expect(ledger).toContain("run-bundle-30-einvoicing-data-2026-10-25.sql");
    expect(ledger).toMatch(/0219_einvoicing_data\.sql -- PENDING/);
  });
});
