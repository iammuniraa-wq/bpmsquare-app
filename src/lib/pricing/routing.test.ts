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
    expect(ctx.header).toEqual({ document_type: "quote", customer: { id: "a1", tier: "A" }, region: "North", industry: "Cement" });
    // The router and rule matching read the flattened shape: same dotted keys as ever.
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
});
