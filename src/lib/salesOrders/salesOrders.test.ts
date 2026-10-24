import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { fakeDb } from "@/lib/marketing/testFakeDb";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { clampPercent, cleanDate, cleanOrderLines, computeOrderTotals, expectedDateOf, foldHeaderDiscount, lineNet } from "./totals";
import { cleanPrefix, cleanRules, contextForAccount, pickOrderType, pricingModeFor } from "./rules";
import { addDays, masterAvailability, availabilityView } from "./availability";
import { generateNextSalesOrderRef } from "./ref";
import { signOrderPublicToken, verifyOrderPublicToken } from "../salesOrderPublicLink";
import { signQuotePublicToken, verifyQuotePublicToken } from "../quotePublicLink";
import { attachmentForScreen, cleanKind, fileProblem, validateAttachmentLink } from "./attachments";
import { orderLockReason, orderPermissions } from "./lock";
import { buildOrderWhatsAppMessage } from "../whatsapp";

describe("totals", () => {
  it("works a line out as quantity x price less its discount", () => {
    expect(lineNet(3, 100, 10)).toBe(270);
    expect(lineNet(1, 0.1 + 0.2, 0)).toBe(0.3);
  });

  it("has the same order of operations as a Standard Quote: discount first, tax on what is left, shipping last and untaxed", () => {
    const lines = [{ qty: 2, unit_price: 500, discount_pct: 0, tax_pct: 18 }, { qty: 1, unit_price: 40, discount_pct: 0, tax_pct: 18 }];
    const t = computeOrderTotals(lines, 25);
    const sq = computeStandardQuoteTotals(1040, 0, 18, 25);
    expect(t.total).toBe(Math.round(sq.total * 100) / 100);
    expect(t).toMatchObject({ subtotal: 1040, discount_total: 0, tax_total: 187.2, shipping_amount: 25 });
  });

  it("a quote's header discount folded into each line gives the quote's own total", () => {
    const d = foldHeaderDiscount(10, 10);
    expect(d).toBe(19);
    const lines = [{ qty: 2, unit_price: 250, discount_pct: foldHeaderDiscount(0, 10), tax_pct: 18 }, { qty: 2, unit_price: 300, discount_pct: d, tax_pct: 18 }];
    expect(computeOrderTotals(lines, 50).total).toBeCloseTo(computeStandardQuoteTotals(1040, 10, 18, 50).total, 2);
    expect(foldHeaderDiscount(0, 0)).toBe(0);
    expect(foldHeaderDiscount(100, 20)).toBe(100);
  });

  it("expected delivery is the latest confirmed date across the lines", () => {
    expect(expectedDateOf([{ confirmed_date: "2026-06-10" }, { confirmed_date: null }, { confirmed_date: "2026-07-01" }])).toBe("2026-07-01");
    expect(expectedDateOf([{ confirmed_date: null }])).toBeNull();
    expect(expectedDateOf([])).toBeNull();
  });

  it("cleans lines from a request: clamps, drops blank descriptions, never trusts line_total", () => {
    const out = cleanOrderLines([
      { description: " Pump ", qty: "3", unit_price: "100", discount_pct: 150, tax_pct: -5, line_total: 1, requested_date: "2026-02-30" },
      { description: "" },
      { description: "No qty", unit_price: 10 },
      { description: "Negative", qty: -4, unit_price: -9 },
      null,
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ description: "Pump", qty: 3, unit_price: 100, discount_pct: 100, tax_pct: 0, line_total: 0, requested_date: null });
    expect(out[1]).toMatchObject({ qty: 1, line_total: 10 });
    expect(out[2]).toMatchObject({ qty: 0, unit_price: 0 });
    expect(cleanOrderLines("nope")).toEqual([]);
  });

  it("caps the number of lines", () => {
    expect(cleanOrderLines(Array.from({ length: 500 }, (_, i) => ({ description: `L${i}` })))).toHaveLength(200);
  });

  it("dates must exist", () => {
    expect(cleanDate("2026-02-28")).toBe("2026-02-28");
    expect(cleanDate("2026-02-30")).toBeNull();
    expect(cleanDate("28/02/2026")).toBeNull();
    expect(cleanDate(20260228)).toBeNull();
    expect(clampPercent("abc")).toBe(0);
  });
});

describe("order type rules", () => {
  const t = (id: string, o: Partial<Parameters<typeof pickOrderType>[0][number]> & { rules?: unknown }) =>
    ({ id, rules: [], is_default: false, active: true, sort_order: 0, ...o }) as Parameters<typeof pickOrderType>[0][number];

  it("a rule matches case-insensitively, any one rule of a type is enough, and the lowest sort order wins", () => {
    const types = [
      t("late", { sort_order: 9, rules: [{ field: "customer_group", equals: "vip" }] }),
      t("early", { sort_order: 1, rules: [{ field: "region", equals: "dubai" }, { field: "customer_group", equals: "vip" }] }),
      t("def", { is_default: true, sort_order: 5 }),
    ];
    expect(pickOrderType(types, { customer_group: "VIP", region: null })?.type.id).toBe("early");
    expect(pickOrderType(types, { customer_group: "retail", region: "Dubai" })?.type).toMatchObject({ id: "early" });
    expect(pickOrderType(types, { customer_group: "retail", region: "Pune" })).toMatchObject({ via: "default", type: { id: "def" } });
  });

  it("matches the region against both state and country, and the source type", () => {
    const ctx = contextForAccount({ type: "end_customer", state: "Maharashtra", country: "India" }, "standard_quote");
    const types = [t("in", { rules: [{ field: "region", equals: "india" }] }), t("sq", { sort_order: 1, rules: [{ field: "source_type", equals: "standard_quote" }] })];
    expect(pickOrderType(types, ctx)?.type.id).toBe("in");
    expect(pickOrderType([types[1]], ctx)?.via).toBe("rule");
    expect(ctx.customer_group).toBe("end_customer");
  });

  it("an inactive type is never picked, an empty rule list never matches, and with no default the first active type is used", () => {
    const types = [t("off", { active: false, is_default: true, rules: [{ field: "customer_group", equals: "x" }] }), t("a", { sort_order: 2 }), t("b", { sort_order: 1 })];
    expect(pickOrderType(types, { customer_group: "x" })).toMatchObject({ via: "first", type: { id: "b" } });
    expect(pickOrderType([], {})).toBeNull();
    expect(pickOrderType([types[0]], { customer_group: "x" })).toBeNull();
  });

  it("drops malformed rules so a bad row can never match everything", () => {
    expect(cleanRules([{ field: "colour", equals: "red" }, { field: "region", equals: "  " }, { field: "region" }, null, { field: "region", equals: "Doha" }])).toEqual([{ field: "region", equals: "Doha" }]);
    expect(cleanRules("x")).toEqual([]);
  });

  it("the pricing mode is the source quote's when there is one, else the type's", () => {
    expect(pricingModeFor({ pricing_mode: "external" }, null)).toBe("external");
    expect(pricingModeFor({ pricing_mode: "external" }, "internal")).toBe("internal");
    expect(pricingModeFor(null, null)).toBe("internal");
  });

  it("numbering prefixes are short, upper case, letters and digits", () => {
    expect(cleanPrefix(" so ")).toBe("SO");
    expect(cleanPrefix("ex-1")).toBe("EX1");
    for (const bad of ["S", "1AB", "TOO-LONG-PREFIX", "", null, "a b!"]) expect(cleanPrefix(bad)).toBeNull();
  });
});

describe("master-data availability", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it.each([
    ["stock covers", { qty: 4 }, { stock: 4, leadTimeDays: 30 }, { confirmed_qty: 4, confirmed_date: "2026-06-10", basis: "stock" }],
    ["short, lead time", { qty: 4 }, { stock: 3, leadTimeDays: 14 }, { confirmed_qty: 4, confirmed_date: "2026-06-24", basis: "lead_time" }],
    ["no stock row, lead time", { qty: 4 }, { stock: null, leadTimeDays: 0 }, { confirmed_qty: 4, confirmed_date: "2026-06-10", basis: "lead_time" }],
    ["short, no lead time", { qty: 4 }, { stock: 3, leadTimeDays: null }, { confirmed_qty: 3, confirmed_date: null, basis: "short" }],
    ["negative stock counts as none", { qty: 4 }, { stock: -2, leadTimeDays: null }, { confirmed_qty: 0, confirmed_date: null, basis: "short" }],
    ["nothing known", { qty: 4 }, { stock: null, leadTimeDays: null }, { confirmed_qty: null, confirmed_date: null, basis: "unknown" }],
  ])("%s", (_n, line, basis, want) => {
    expect(masterAvailability(line, basis, "2026-06-10")).toEqual(want);
  });

  it("the availability view names the source and the state of each line", () => {
    const v = availabilityView(
      { id: "o", status: "confirmed", expected_date: "2026-07-01" },
      [{ id: "l", order_id: "o", line_no: 1, product_id: null, description: "x", printed_text: null, qty: 5, uom: null, unit_price: 1, discount_pct: 0, tax_pct: 0, line_total: 5, requested_date: "2026-06-20", confirmed_qty: 5, confirmed_date: "2026-07-01", availability_source: "erp", availability_at: "2026-06-10T00:00:00Z" }],
    );
    expect(v.lines[0]).toMatchObject({ source: "erp", source_label: "ERP", state: "late" });
    expect(v).toMatchObject({ stale: false, needs_attention: true, expected_date: "2026-07-01", refreshed_at: "2026-06-10T00:00:00Z" });
  });
});

describe("order refs", () => {
  it("counts per tenant and prefix from the highest existing number and walks past a taken ref", async () => {
    const db = fakeDb({
      sales_orders: [
        { id: "1", tenant_id: "t1", ref: "SO-0003", created_at: "1" },
        { id: "2", tenant_id: "t1", ref: "SO-0010", created_at: "2" },
        { id: "3", tenant_id: "t1", ref: "EX-0044", created_at: "3" },
        { id: "4", tenant_id: "t2", ref: "SO-0500", created_at: "4" },
        { id: "5", tenant_id: "t1", ref: "SOX-0002", created_at: "5" },
      ],
    });
    expect(await generateNextSalesOrderRef(db.client, "t1", "SO")).toBe("SO-0011");
    expect(await generateNextSalesOrderRef(db.client, "t1", "EX")).toBe("EX-0045");
    expect(await generateNextSalesOrderRef(db.client, "t1", "NEW")).toBe("NEW-0001");
    expect(await generateNextSalesOrderRef(db.client, "t2", "SO")).toBe("SO-0501");
  });
});

describe("public order link", () => {
  const prev = process.env.QUOTE_PUBLIC_LINK_SECRET;
  beforeEach(() => { process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret-for-order-links"; });
  afterEach(() => {
    if (prev === undefined) delete process.env.QUOTE_PUBLIC_LINK_SECRET; else process.env.QUOTE_PUBLIC_LINK_SECRET = prev;
    vi.useRealTimers();
  });

  it("verifies a token for exactly the order it was signed for", () => {
    const token = signOrderPublicToken("order-1")!;
    expect(verifyOrderPublicToken("order-1", token)).toBe(true);
    expect(verifyOrderPublicToken("order-2", token)).toBe(false);
  });

  it("rejects a tampered signature, a tampered expiry, garbage and an empty token", () => {
    const token = signOrderPublicToken("order-1")!;
    const [exp, sig] = token.split(".");
    expect(verifyOrderPublicToken("order-1", `${exp}.${sig.slice(0, -2)}xx`)).toBe(false);
    expect(verifyOrderPublicToken("order-1", `${Number(exp) + 1000}.${sig}`)).toBe(false);
    for (const bad of ["", "abc", ".", "1.2.3", "NaN.x"]) expect(verifyOrderPublicToken("order-1", bad)).toBe(false);
  });

  it("expires after its lifetime (90 days by default)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    const token = signOrderPublicToken("order-1")!;
    vi.setSystemTime(new Date("2026-08-29T00:00:00Z"));
    expect(verifyOrderPublicToken("order-1", token)).toBe(true);
    vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));
    expect(verifyOrderPublicToken("order-1", token)).toBe(false);
  });

  it("a quote's link can never open an order, nor an order's link a quote", () => {
    const quoteToken = signQuotePublicToken("same-id")!;
    expect(verifyOrderPublicToken("same-id", quoteToken)).toBe(false);
    const orderToken = signOrderPublicToken("same-id")!;
    expect(verifyQuotePublicToken("same-id", orderToken)).toBe(false);
  });

  it("without the secret no token is made and none verifies", () => {
    const token = signOrderPublicToken("order-1")!;
    delete process.env.QUOTE_PUBLIC_LINK_SECRET;
    expect(signOrderPublicToken("order-1")).toBeNull();
    expect(verifyOrderPublicToken("order-1", token)).toBe(false);
  });

  it("the WhatsApp message carries the link, or asks for the PDF to be attached when there is none", () => {
    const base = { customer_name: "Sam", company_name: "Acme", order_ref: "SO-0001", order_total: "QAR 1,000" };
    expect(buildOrderWhatsAppMessage({ ...base, pdfLink: "https://x/y" })).toContain("https://x/y");
    expect(buildOrderWhatsAppMessage(base)).toContain("emailed the PDF");
  });
});

describe("attachments", () => {
  it("accepts documents and drawings up to 15 MB and refuses the rest", () => {
    expect(fileProblem({ name: "PO-7781.PDF", size: 1000 })).toBeNull();
    expect(fileProblem({ name: "plan.dwg", size: 1000 })).toBeNull();
    expect(fileProblem({ name: "logo.svg", size: 1000 })).toMatch(/isn't accepted/);
    expect(fileProblem({ name: "run.exe", size: 1000 })).toMatch(/isn't accepted/);
    expect(fileProblem({ name: "big.pdf", size: 16 * 1024 * 1024 })).toMatch(/too large/);
    expect(fileProblem({ name: "empty.pdf", size: 0 })).toMatch(/empty/);
  });

  it("a link is an https address without credentials", () => {
    expect(validateAttachmentLink(" https://files.example.com/a/b.pdf?x=1 ")).toMatchObject({ ok: true, host: "files.example.com" });
    for (const bad of ["http://example.com/a", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com/x", "https://user:pw@example.com/x", "https://localhost/x", "not a url", "", 5, null, `https://example.com/${"a".repeat(2100)}`]) {
      expect(validateAttachmentLink(bad).ok, String(bad)).toBe(false);
    }
  });

  it("the kind falls back to other, and a listed file never shows its storage path", () => {
    expect(cleanKind("drawing")).toBe("drawing");
    expect(cleanKind("hax")).toBe("other");
    const row = { id: "a1", order_id: "o1", kind: "customer_po", type: "file", name: "po.pdf", ref: "t1/o1/uuid.pdf", size_bytes: 10, created_by: "u1", created_at: "x" };
    expect(attachmentForScreen("o1", row)).toMatchObject({ ref: "", href: "/api/sales-orders/o1/attachments/a1" });
    expect(attachmentForScreen("o1", { ...row, type: "link", ref: "https://x.test/p" })).toMatchObject({ ref: "https://x.test/p", href: "https://x.test/p" });
  });
});

describe("lock reasons", () => {
  it("says nothing for an editable order and a specific thing otherwise", () => {
    expect(orderLockReason({ origin: "bpmsquare", status: "draft" }, false)).toBeNull();
    expect(orderLockReason({ origin: "bpmsquare", status: "confirmed" }, false)).toMatch(/Reopen/);
    expect(orderLockReason({ origin: "bpmsquare", status: "draft" }, true)).toMatch(/ERP has accepted/);
    expect(orderLockReason({ origin: "erp", status: "draft" }, false)).toMatch(/comes from the ERP/);
    expect(orderLockReason({ origin: "bpmsquare", status: "cancelled" }, false)).toMatch(/Cancelled/);
  });

  it("permissions are the shared rule functions' answers", () => {
    expect(orderPermissions({ origin: "bpmsquare", status: "draft" }, false)).toMatchObject({ editable: true, annotatable: true, deletable: true });
    expect(orderPermissions({ origin: "bpmsquare", status: "confirmed" }, false)).toMatchObject({ editable: false, annotatable: true, deletable: false });
    expect(orderPermissions({ origin: "erp", status: "confirmed" }, false)).toMatchObject({ editable: false, annotatable: false, deletable: false });
  });
});
