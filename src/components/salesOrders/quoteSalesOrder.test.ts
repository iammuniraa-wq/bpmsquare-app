import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

const state = vi.hoisted(() => ({ flag: true as boolean | undefined, order: null as { id: string; ref: string } | null, throws: false }));

vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => create("a", { href: p.href }, p.children as never) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/tenant", () => ({ getTenant: async () => ({ features: { sales_orders: state.flag } }) }));
vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => { if (state.throws) throw { status: 401 }; return { supabase: {}, tenantId: "t1" }; },
}));
vi.mock("./serverData", () => ({ findOrderForSource: async () => state.order }));

import QuoteSalesOrder from "./QuoteSalesOrder";

const draw = async (p: { ready: boolean; sourceType?: "quotation" | "standard_quote" }) => {
  const el = await QuoteSalesOrder({ sourceType: p.sourceType ?? "quotation", sourceId: "q1", ready: p.ready });
  return el === null ? null : renderToString(el as ReactElement).replace(/<!-- -->/g, "");
};

beforeEach(() => { state.flag = true; state.order = null; state.throws = false; });

describe("the sales order strip on a quotation", () => {
  it("renders nothing for a workspace without Sales Orders, whatever the quote's state", async () => {
    state.flag = false;
    expect(await draw({ ready: true })).toBeNull();
    state.flag = undefined;
    expect(await draw({ ready: true })).toBeNull();
    state.order = { id: "o1", ref: "SO-0001" };
    state.flag = false;
    expect(await draw({ ready: true })).toBeNull();
  });
  it("renders nothing until the quote is accepted or won, and when the session cannot be read", async () => {
    expect(await draw({ ready: false })).toBeNull();
    state.throws = true;
    expect(await draw({ ready: true })).toBeNull();
  });
  it("offers 'Create sales order' once the quotation is won and no order exists", async () => {
    const out = await draw({ ready: true });
    expect(out).toContain("Create sales order");
    expect(out).toContain("quote.create_sales_order");
  });
  it("shows the order made from it as a link instead, even if the quote is no longer ready", async () => {
    state.order = { id: "o1", ref: "SO-0001" };
    for (const ready of [true, false]) {
      const out = await draw({ ready });
      expect(out).toContain('href="/sales-orders/o1"');
      expect(out).toContain("SO-0001");
      expect(out).not.toContain("Create sales order");
    }
  });
});
