import { describe, it, expect } from "vitest";
import { rfqLineActionState, SAVE_FIRST_MESSAGE } from "./lineAction";

const DOC = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const LINE = "11111111-2222-4333-8444-555555555555";

describe("rfqLineActionState", () => {
  it("is ready for a saved line on a saved document", () => {
    expect(rfqLineActionState({ documentId: DOC, lineId: LINE, description: "PTFE sheet" })).toEqual({ eligible: true, ready: true, reason: null });
  });
  it("asks for a save first when the document or the line is not saved", () => {
    expect(rfqLineActionState({ documentId: undefined, lineId: LINE, description: "x" })).toEqual({ eligible: true, ready: false, reason: SAVE_FIRST_MESSAGE });
    expect(rfqLineActionState({ documentId: DOC, lineId: "k3j2h1g", description: "x" })).toEqual({ eligible: true, ready: false, reason: SAVE_FIRST_MESSAGE });
  });
  it("offers nothing on break rows, lines already on an RFQ, or blank lines", () => {
    expect(rfqLineActionState({ documentId: DOC, lineId: LINE, description: "x", isBreak: true }).eligible).toBe(false);
    expect(rfqLineActionState({ documentId: DOC, lineId: LINE, description: "x", hasRfq: true }).eligible).toBe(false);
    expect(rfqLineActionState({ documentId: DOC, lineId: LINE, description: "   " }).eligible).toBe(false);
  });
});
