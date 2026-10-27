import { describe, it, expect } from "vitest";
import { orderCandidates } from "./rules";
import { groupOpen, rankFocus } from "./score";

// "N orders to confirm": the person's own draft sales orders, nothing else.

const today = "2026-06-10";
const tz = "UTC";

describe("orders to confirm in the briefing", () => {
  it("one candidate per draft order, aged in days, linked to the order", () => {
    const c = orderCandidates([
      { id: "o1", ref: "SO-0001", status: "draft", total: 1500, created_at: "2026-06-05T08:00:00Z" },
      { id: "o2", ref: "SO-0002", status: "draft", total: 0, created_at: "2026-06-10T08:00:00Z" },
    ], today, tz);
    expect(c.map((x) => [x.id, x.kind, x.days, x.href])).toEqual([
      ["order:o1", "order_confirm", 5, "/sales-orders/o1"],
      ["order:o2", "order_confirm", 0, "/sales-orders/o2"],
    ]);
    expect(c[0]).toMatchObject({ objectType: "sales_order", ownership: "own", value: 1500 });
    expect(c[1].value).toBeUndefined();
  });

  it("a confirmed or cancelled order is not waiting for the person", () => {
    expect(orderCandidates([{ id: "o1", status: "confirmed" }, { id: "o2", status: "cancelled" }, { status: "draft" }], today, tz)).toEqual([]);
  });

  it("is grouped as 'N orders to confirm' and links to the one order or to the list", () => {
    const one = groupOpen(orderCandidates([{ id: "o1", ref: "SO-0001", status: "draft", created_at: "2026-06-09T00:00:00Z" }], today, tz));
    expect(one).toMatchObject([{ id: "open:order_confirm", label: "1 order to confirm", href: "/sales-orders/o1" }]);
    const many = groupOpen(orderCandidates([
      { id: "o1", status: "draft", created_at: "2026-06-09T00:00:00Z" }, { id: "o2", status: "draft", created_at: "2026-06-01T00:00:00Z" },
    ], today, tz));
    expect(many).toMatchObject([{ label: "2 orders to confirm", href: "/sales-orders", count: 2 }]);
  });

  it("ranks with its working shown: older drafts first", () => {
    const f = rankFocus(orderCandidates([
      { id: "new", status: "draft", created_at: "2026-06-10T00:00:00Z" }, { id: "old", status: "draft", created_at: "2026-05-01T00:00:00Z" },
    ], today, tz));
    expect(f.map((x) => x.id)).toEqual(["order:old", "order:new"]);
    expect(f[0].why).toMatch(/not confirmed for \d+ days/);
  });
});
