import { describe, expect, it } from "vitest";
import { orderAnnotatable, orderDeletable, orderEditable } from "./types";

describe("the order edit rule", () => {
  it("lets a draft made here be edited and deleted until an ERP accepts it", () => {
    expect(orderEditable({ origin: "bpmsquare", status: "draft" }, false)).toBe(true);
    expect(orderDeletable({ origin: "bpmsquare", status: "draft" }, false)).toBe(true);
    expect(orderEditable({ origin: "bpmsquare", status: "draft" }, true)).toBe(false);
  });
  it("locks confirmed, cancelled and ERP-origin orders", () => {
    expect(orderEditable({ origin: "bpmsquare", status: "confirmed" }, false)).toBe(false);
    expect(orderEditable({ origin: "erp", status: "draft" }, false)).toBe(false);
    expect(orderDeletable({ origin: "bpmsquare", status: "confirmed" }, false)).toBe(false);
  });
  it("keeps notes and files open on a confirmed order made here, not on ERP or cancelled ones", () => {
    expect(orderAnnotatable({ origin: "bpmsquare", status: "confirmed" })).toBe(true);
    expect(orderAnnotatable({ origin: "erp", status: "confirmed" })).toBe(false);
    expect(orderAnnotatable({ origin: "bpmsquare", status: "cancelled" })).toBe(false);
  });
});
