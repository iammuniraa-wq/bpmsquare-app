import { describe, expect, it, vi } from "vitest";
import { sendDataverseSalesOrder } from "./erpOrder";
import { bpmMarker } from "./payload";
import { ErpStepError, type ErpHttp } from "./erp";

// Dynamics can take longer to answer a create than we wait. The order may exist even though our call timed out, so a timeout is
// checked against the order's marker before it is called a failure.
const DOC = "11111111-1111-1111-1111-111111111111";

function http(over: { createThrows: unknown; found: boolean }): ErpHttp {
  let created = false;
  return {
    get: vi.fn(async (path: string) => {
      if (path === "salesorders" && over.found && created) {
        return { value: [{ salesorderid: "o-1", ordernumber: "ORD-01001-X", statecode: 0, totalamount: 25, name: "SO-0004 A", description: `Sent from BPMSquare\n${bpmMarker(DOC)}` }] };
      }
      return { value: [] };
    }),
    create: vi.fn(async () => { created = true; throw over.createThrows; }),
  } as unknown as ErpHttp;
}

const base = { ref: "SO-0004", docId: DOC, existingId: null, create: { name: "SO-0004 A" } };

describe("a create that timed out", () => {
  it("is a success when the order is found afterwards, and the link is written", async () => {
    const onCreated = vi.fn(async () => {});
    const r = await sendDataverseSalesOrder(http({ createThrows: Object.assign(new Error("Dynamics 365 did not answer in time"), { status: 0 }), found: true }), { ...base, onCreated });
    expect(r).toMatchObject({ orderNumber: "ORD-01001-X", created: true, alreadyDone: false });
    expect(onCreated).toHaveBeenCalledOnce();
  });
  it("is still a failure when no such order exists", async () => {
    const onCreated = vi.fn(async () => {});
    await expect(sendDataverseSalesOrder(http({ createThrows: Object.assign(new Error("Dynamics 365 did not answer in time"), { status: 0 }), found: false }), { ...base, onCreated }))
      .rejects.toBeInstanceOf(ErpStepError);
    expect(onCreated).not.toHaveBeenCalled();
  });
  it("does not look again for an error Dynamics did answer (a 400 is a real refusal)", async () => {
    const h = http({ createThrows: Object.assign(new Error("bad"), { status: 400 }), found: true });
    await expect(sendDataverseSalesOrder(h, { ...base, onCreated: async () => {} })).rejects.toBeInstanceOf(ErpStepError);
  });
});
