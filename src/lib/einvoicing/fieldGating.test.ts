import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { getEffectiveFieldConfig } from "@/lib/fieldConfig";
import { FIELD_REGISTRY } from "@/lib/fieldRegistry";
import { ACCOUNT_EINVOICE_KEYS } from "./accountFields";

// The registry fields of Saudi e-invoicing reach a form, an export or the generic edit screen only through
// getEffectiveFieldConfig -- so this is the place that proves a workspace without the feature sees none of them.

const ACCOUNT_KEYS = ["buyer_type", "vat_number", "crn", "name_ar", "address_building", "address_district", "buyer_id_scheme", "buyer_id_number"];
const INVOICE_KEYS = ["einvoice_doc_type", "einvoice_seq", "einvoice_uuid", "supply_date", "credit_reason"];

function db(tenant: Row, opts: { missingColumns?: string[] } = {}): SupabaseClient {
  const base = fakeDb({ tenants: [tenant], accounts: [{ id: "a1", tenant_id: "t1" }], invoices: [{ id: "i1", tenant_id: "t1" }] }).client;
  const missing = new Set(opts.missingColumns ?? []);
  return {
    from: (t: string) => {
      const q = base.from(t) as unknown as Record<string, unknown>;
      const select = q.select as (c?: string) => unknown;
      q.select = (cols?: string) => {
        if (cols && missing.has(cols)) {
          const b: Record<string, unknown> = { eq: () => b, limit: () => b, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "42703", message: `column "${cols}" does not exist` } }).then(res) };
          return b;
        }
        return select.call(q, cols);
      };
      return q;
    },
  } as unknown as SupabaseClient;
}
const keysOf = async (client: SupabaseClient, object: string) => (await getEffectiveFieldConfig(client, "t1", object)).sections.flatMap((s) => s.fields.map((f) => f.field_key));

describe("e-invoice fields in the field registry", () => {
  it("every one is gated on the platform-admin flag and export-only (no bulk import / update)", () => {
    for (const [object, keys] of [["account", ACCOUNT_KEYS], ["invoice", INVOICE_KEYS]] as const) {
      for (const k of keys) {
        const f = FIELD_REGISTRY[object].fields.find((x) => x.key === k)!;
        expect(f, `${object}.${k}`).toBeTruthy();
        expect(f.requiresFeature).toBe("einvoicing_ksa");
        expect(f.exportOnly).toBe(true);
      }
    }
    expect(ACCOUNT_KEYS.sort()).toEqual([...ACCOUNT_EINVOICE_KEYS].sort());
  });

  it("the system-set ones are read-only on screen", () => {
    for (const k of ["einvoice_doc_type", "einvoice_seq", "einvoice_uuid"]) expect(FIELD_REGISTRY.invoice.fields.find((f) => f.key === k)!.editable).toBe(false);
  });

  it("a workspace without the flag gets none of them", async () => {
    const c = db({ id: "t1", features: { invoices: true, accounts: true }, config: {} });
    const acc = await keysOf(c, "account");
    const inv = await keysOf(c, "invoice");
    for (const k of ACCOUNT_KEYS) expect(acc).not.toContain(k);
    for (const k of INVOICE_KEYS) expect(inv).not.toContain(k);
    // and what it always had is untouched
    expect(acc).toEqual(expect.arrayContaining(["name", "gstin", "postal_code"]));
    expect(inv).toEqual(expect.arrayContaining(["due_date", "notes"]));
  });

  it("a workspace with the flag gets all of them", async () => {
    const c = db({ id: "t1", features: { einvoicing_ksa: true }, config: {} });
    const acc = await keysOf(c, "account");
    const inv = await keysOf(c, "invoice");
    for (const k of ACCOUNT_KEYS) expect(acc).toContain(k);
    for (const k of INVOICE_KEYS) expect(inv).toContain(k);
  });

  it("the scheme can switch it off even with the flag on", async () => {
    const c = db({ id: "t1", features: { einvoicing_ksa: true }, config: { einvoicing: { scheme: null } } });
    expect(await keysOf(c, "invoice")).not.toContain("supply_date");
    expect(await keysOf(c, "account")).not.toContain("vat_number");
  });

  it("while migration 0219 is pending the fields are hidden, so a save can never become an error", async () => {
    const c = db({ id: "t1", features: { einvoicing_ksa: true }, config: {} }, { missingColumns: [...ACCOUNT_KEYS, ...INVOICE_KEYS] });
    expect(await keysOf(c, "account")).not.toContain("vat_number");
    expect(await keysOf(c, "invoice")).not.toContain("supply_date");
  });

  it("the new account section only shows its own fields", async () => {
    const c = db({ id: "t1", features: { einvoicing_ksa: true }, config: {} });
    const sections = (await getEffectiveFieldConfig(c, "t1", "account")).sections;
    const sec = sections.find((s) => s.label === "Saudi e-invoicing")!;
    expect(sec.fields.map((f) => f.field_key).sort()).toEqual([...ACCOUNT_KEYS].sort());
  });
});
