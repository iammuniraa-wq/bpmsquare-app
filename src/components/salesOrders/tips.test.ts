import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { LOCK_REASONS, ORDER_TIPS } from "./tips";
import { lockInfo } from "./logic";

describe("the Sales Order tips", () => {
  for (const [key, text] of Object.entries(ORDER_TIPS)) {
    it(`${key} fits the limit`, () => expect(tipTextProblems(text)).toEqual([]));
  }
  for (const text of LOCK_REASONS) it(`the lock reason "${text.slice(0, 28)}..." fits`, () => expect(tipTextProblems(text)).toEqual([]));
  it("every reason lockInfo can give is one of the tested texts", () => {
    const given = [
      lockInfo({ origin: "erp", status: "draft" }, false), lockInfo({ origin: "bpmsquare", status: "cancelled" }, false),
      lockInfo({ origin: "bpmsquare", status: "draft" }, true), lockInfo({ origin: "bpmsquare", status: "confirmed" }, false),
    ].map((l) => l.reason);
    for (const r of given) expect(LOCK_REASONS).toContain(r);
  });
});
