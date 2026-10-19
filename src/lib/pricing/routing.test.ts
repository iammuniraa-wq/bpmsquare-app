import { describe, it, expect } from "vitest";
import { routeToArea, quoteLineContext } from "./routing";
import { flattenContext } from "@/lib/pricing-core";

describe("routeToArea", () => {
  const routing = {
    rules: [
      { attribute: "product.category", value: "SPARES", area: "spares" },
      { attribute: "product.category", value: "MODERNISATION", area: "projects" },
      { attribute: "document_type", value: "work_order", area: "service_rates" },
    ],
    default_area: "standard_parts",
  };

  it("takes the first matching rule, case-insensitively", () => {
    expect(routeToArea(routing, { "product.category": "spares", document_type: "quote" })).toMatchObject({ area: "spares" });
    expect(routeToArea(routing, { "product.category": "MODERNISATION", document_type: "work_order" })).toMatchObject({ area: "projects" });
  });

  it("falls back to the default book, and to 'default' with no config", () => {
    expect(routeToArea(routing, { "product.category": "OTHER", document_type: "quote" }).area).toBe("standard_parts");
    expect(routeToArea(null, { document_type: "quote" }).area).toBe("default");
    expect(routeToArea({ rules: [], default_area: "  " }, {}).area).toBe("default");
  });
});

describe("quoteLineContext", () => {
  it("maps account and product fields onto the engine's conventional dimensions", () => {
    const ctx = quoteLineContext({
      documentType: "quote",
      account: { id: "a1", type: "A", state: "North", industry: "Cement" },
      product: { id: "p1", name: "Door operator", category: "SPARES", sub_category: "DOORS", list_price: 118000, uom: "Nos", tax_percent: 18 },
    });
    // Quotations keep their original flat keys (left exactly as they were).
    expect(ctx.header).toEqual({ document_type: "quote", "customer.id": "a1", "customer.tier": "A", region: "North", industry: "Cement" });
    expect(flattenContext(ctx.header)).toEqual({ document_type: "quote", "customer.id": "a1", "customer.tier": "A", region: "North", industry: "Cement" });
    expect(ctx.line["product.category"]).toBe("SPARES");
    expect(ctx.line["product.sub_category"]).toBe("DOORS");
    expect((ctx.line.product as { list_price: number }).list_price).toBe(118000);
  });

  it("leaves customer out when there is no account, and nests the product for formulas", () => {
    const ctx = quoteLineContext({ documentType: "standard_quote", account: null, product: { id: "p1", name: "Wire rope", category: "SPARES", sub_category: "ROPES", list_price: 420 } });
    expect(ctx.header).toEqual({ document_type: "standard_quote" });
    expect(ctx.line.product).toMatchObject({ base_model: "Wire rope", category: "SPARES", sub_category: "ROPES", list_price: 420 });
    expect(flattenContext(ctx.line)["product.sub_category"]).toBe("ROPES");
  });

  it("nests the customer for a standard quote so ctx.customer.tier works in formulas", () => {
    const ctx = quoteLineContext({ documentType: "standard_quote", account: { id: "a1", type: "A" }, product: { id: "p1", name: "Wire rope" } });
    expect(ctx.header).toEqual({ document_type: "standard_quote", customer: { id: "a1", tier: "A" } });
  });
});

describe("routeToArea document-type fence", () => {
  const routing = { rules: [{ attribute: "product.category", value: "SPARES", area: "cost_plus", document_types: ["standard_quote", "opportunity"] }], default_area: "default" };
  it("applies to the named document types only, never to a Quotation", () => {
    expect(routeToArea(routing, { "product.category": "SPARES", document_type: "standard_quote" }).area).toBe("cost_plus");
    expect(routeToArea(routing, { "product.category": "SPARES", document_type: "opportunity" }).area).toBe("cost_plus");
    expect(routeToArea(routing, { "product.category": "SPARES", document_type: "quote" }).area).toBe("default");
  });
  it("a rule without the fence applies to every document type", () => {
    const open = { rules: [{ attribute: "product.category", value: "SPARES", area: "cost_plus" }], default_area: "default" };
    expect(routeToArea(open, { "product.category": "SPARES", document_type: "quote" }).area).toBe("cost_plus");
  });
});
