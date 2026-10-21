import { describe, it, expect } from "vitest";
import { sendDataverseQuote, findQuoteByRef, getQuoteState, ErpStepError } from "./erp";
import { FakeDataverse } from "./fakeDataverse";
import { buildDataverseQuote } from "./payload";
import { D365_OUTBOUND_PRESETS } from "@/lib/connectors/d365/catalog";

const DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_DOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const q = {
  ref: "SQ-0001", doc_id: DOC, title: "Fence", customer_name: "A. Datum", account_external_id: "acc-guid", description: ["d"], subtotal: 30, total: 30, valid_until: null, outcome: "awarded" as const,
  lines: [{ sl_no: "1", description: "Post", uom: null, qty: 2, rate: 10, discount_pct: 0, amount: 20 }, { sl_no: "2", description: "Gate", uom: null, qty: 1, rate: 10, discount_pct: 0, amount: 10 }],
};
const create = () => buildDataverseQuote(q, { price_list_id: "pl", currency_id: "cur" }, { quote: D365_OUTBOUND_PRESETS.dataverse.quote.field_map, quote_line: D365_OUTBOUND_PRESETS.dataverse.quote_line.field_map }).body;
const base = { ref: "SQ-0001", docId: DOC as string | null, existingId: null as string | null, create: create(), onCreated: async () => {} };

describe("Dataverse quote lifecycle", () => {
  it("awarded: creates (Draft), activates, then WinQuote -> Won, with the sum checked", async () => {
    const dv = new FakeDataverse();
    const created: string[] = [];
    const r = await sendDataverseQuote(dv, { ...base, outcome: "awarded", onCreated: async (s) => { created.push(s.quoteId); } });
    expect(dv.quotes).toHaveLength(1);
    expect(dv.quotes[0]).toMatchObject({ statecode: 2, statuscode: 4, totalamount: 30 });
    expect(r.quoteNumber).toMatch(/^QUO-/);
    expect(r.created).toBe(true);
    expect(created).toEqual([dv.quotes[0].quoteid]);
    expect(dv.calls.map((c) => `${c.method} ${c.path}`)).toEqual(expect.arrayContaining(["POST quotes", `PATCH quotes(${dv.quotes[0].quoteid})`, "POST WinQuote"]));
  });

  it("rejected: the same activate, then CloseQuote Status 5 -> Closed (Lost)", async () => {
    const dv = new FakeDataverse();
    await sendDataverseQuote(dv, { ...base, outcome: "rejected" });
    expect(dv.quotes[0]).toMatchObject({ statecode: 3, statuscode: 5 });
    expect(dv.calls.some((c) => c.path === "CloseQuote")).toBe(true);
    expect(dv.calls.some((c) => c.path === "WinQuote")).toBe(false);
  });

  it("the link is saved while the quote is still a draft (before activate)", async () => {
    const dv = new FakeDataverse();
    dv.failOnce.activate = { status: 500, message: "boom" };
    let stateAtLink: number | null = null;
    await expect(sendDataverseQuote(dv, { ...base, outcome: "awarded", onCreated: async (s) => { stateAtLink = dv.quotes.find((x) => x.quoteid === s.quoteId)!.statecode; } })).rejects.toBeInstanceOf(ErpStepError);
    expect(stateAtLink).toBe(0);
  });

  it("resumes after a failed activate: no second quote, finishes the job", async () => {
    const dv = new FakeDataverse();
    dv.failOnce.activate = { status: 503, message: "busy" };
    let id = "";
    const err = await sendDataverseQuote(dv, { ...base, outcome: "awarded", onCreated: async (s) => { id = s.quoteId; } }).catch((e) => e as ErpStepError);
    expect(err).toBeInstanceOf(ErpStepError);
    expect((err as ErpStepError).step).toBe("activate");
    expect(dv.quotes[0].statecode).toBe(0);
    const r = await sendDataverseQuote(dv, { ...base, outcome: "awarded", existingId: id });
    expect(dv.quotes).toHaveLength(1);
    expect(dv.quotes[0].statecode).toBe(2);
    expect(r.created).toBe(false);
  });

  it("resumes after a failed WinQuote from the Active state", async () => {
    const dv = new FakeDataverse();
    dv.failOnce.WinQuote = { status: 500, message: "boom" };
    let id = "";
    await sendDataverseQuote(dv, { ...base, outcome: "awarded", onCreated: async (s) => { id = s.quoteId; } }).catch(() => {});
    expect(dv.quotes[0].statecode).toBe(1);
    await sendDataverseQuote(dv, { ...base, outcome: "awarded", existingId: id });
    expect(dv.quotes[0].statecode).toBe(2);
    expect(dv.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("is idempotent: a second send finds the finished quote and sends nothing", async () => {
    const dv = new FakeDataverse();
    let id = "";
    await sendDataverseQuote(dv, { ...base, outcome: "awarded", onCreated: async (s) => { id = s.quoteId; } });
    const before = dv.calls.length;
    const r = await sendDataverseQuote(dv, { ...base, outcome: "awarded", existingId: id });
    expect(r.alreadyDone).toBe(true);
    expect(dv.quotes).toHaveLength(1);
    expect(dv.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
  });

  it("adopts a quote found by its marker when the link was lost, instead of making a twin", async () => {
    const dv = new FakeDataverse();
    await dv.create("quotes", create());
    const r = await sendDataverseQuote(dv, { ...base, outcome: "awarded", existingId: null });
    expect(dv.quotes).toHaveLength(1);
    expect(dv.quotes[0].statecode).toBe(2);
    expect(r.created).toBe(false);
  });

  it("recreates when the linked quote was deleted in the ERP", async () => {
    const dv = new FakeDataverse();
    const r = await sendDataverseQuote(dv, { ...base, outcome: "awarded", existingId: "gone-guid" });
    expect(dv.quotes).toHaveLength(1);
    expect(r.created).toBe(true);
  });

  it("refuses to close as Lost a quote that is already Won (and the reverse)", async () => {
    const dv = new FakeDataverse();
    let id = "";
    await sendDataverseQuote(dv, { ...base, outcome: "awarded", onCreated: async (s) => { id = s.quoteId; } });
    const e = await sendDataverseQuote(dv, { ...base, outcome: "rejected", existingId: id }).catch((x) => x as ErpStepError);
    expect(e).toBeInstanceOf(ErpStepError);
    expect((e as ErpStepError).message).toMatch(/already Won/);

    const dv2 = new FakeDataverse();
    await sendDataverseQuote(dv2, { ...base, outcome: "rejected", onCreated: async (s) => { id = s.quoteId; } });
    const e2 = await sendDataverseQuote(dv2, { ...base, outcome: "awarded", existingId: id }).catch((x) => x as ErpStepError);
    expect((e2 as ErpStepError).message).toMatch(/closed as Lost/);
  });

  it("tags a create failure with its step and status", async () => {
    const dv = new FakeDataverse();
    dv.failOnce.create = { status: 403, message: "principal user is missing prvCreateQuote" };
    const e = await sendDataverseQuote(dv, { ...base, outcome: "awarded" }).catch((x) => x as ErpStepError);
    expect(e).toMatchObject({ step: "create", status: 403 });
  });

  it("the fake enforces the live rules: a body without a price list is refused", async () => {
    const dv = new FakeDataverse();
    const body = { ...create() };
    delete body["pricelevelid@odata.bind"];
    await expect(sendDataverseQuote(dv, { ...base, outcome: "awarded", create: body })).rejects.toMatchObject({ step: "create", status: 400 });
  });

  it("finds by ref AND marker, and reads a state", async () => {
    const dv = new FakeDataverse();
    await dv.create("quotes", create());
    expect((await findQuoteByRef(dv, "SQ-0001", DOC))?.statecode).toBe(0);
    expect(await findQuoteByRef(dv, "SQ-0002", DOC)).toBeNull();
    expect(await getQuoteState(dv, "nope")).toBeNull();
  });
});

describe("another workspace's quote with the same ref is never adopted (shared Dataverse environment)", () => {
  // Two BPMSquare workspaces (a dev one and a production demo) can both own an SQ-0001 and both
  // point at one Dynamics environment. Only the marker (the quote's own id) tells them apart.
  const otherCreate = () => buildDataverseQuote({ ...q, doc_id: OTHER_DOC }, { price_list_id: "pl", currency_id: "cur" }, { quote: D365_OUTBOUND_PRESETS.dataverse.quote.field_map, quote_line: D365_OUTBOUND_PRESETS.dataverse.quote_line.field_map }).body;

  it("writes the marker as the last line of the description, whatever the map", () => {
    const body = create();
    expect(String(body.description).split("\n").pop()).toBe(`[bpmsquare:${DOC}]`);
    const noDescription = buildDataverseQuote(q, { price_list_id: "pl", currency_id: "cur" }, { quote: { name: "{name}" }, quote_line: D365_OUTBOUND_PRESETS.dataverse.quote_line.field_map }).body;
    expect(noDescription.description).toBe(`[bpmsquare:${DOC}]`);
    const long = buildDataverseQuote({ ...q, description: ["x".repeat(5000)] }, { price_list_id: "pl", currency_id: "cur" }, { quote: D365_OUTBOUND_PRESETS.dataverse.quote.field_map, quote_line: D365_OUTBOUND_PRESETS.dataverse.quote_line.field_map }).body;
    expect(String(long.description).length).toBeLessThanOrEqual(2000);
    expect(String(long.description).endsWith(`[bpmsquare:${DOC}]`)).toBe(true);
  });

  it("a tenant whose ref matches but whose marker differs creates its own quote and leaves the other alone", async () => {
    const dv = new FakeDataverse();
    await dv.create("quotes", otherCreate());
    await sendDataverseQuote(dv, { ...base, outcome: "awarded" });
    expect(dv.quotes).toHaveLength(2);
    const [theirs, mine] = dv.quotes;
    expect(theirs.statecode).toBe(0);
    expect(mine.statecode).toBe(2);
    expect(String(mine.body.description)).toContain(`[bpmsquare:${DOC}]`);
  });

  it("rejecting SQ-0001 in one workspace does not close the other workspace's SQ-0001", async () => {
    const dv = new FakeDataverse();
    await sendDataverseQuote(dv, { ...base, docId: OTHER_DOC, create: otherCreate(), outcome: "awarded" });
    await sendDataverseQuote(dv, { ...base, outcome: "rejected" });
    expect(dv.quotes).toHaveLength(2);
    expect(dv.quotes[0]).toMatchObject({ statecode: 2 });
    expect(dv.quotes[1]).toMatchObject({ statecode: 3 });
  });

  it("only a whole marker token matches, and nothing is adopted without a marker to match", async () => {
    const dv = new FakeDataverse();
    const body = create();
    body.description = `${DOC} [bpmsquare:${DOC}x]`;
    await dv.create("quotes", body);
    expect(await findQuoteByRef(dv, "SQ-0001", DOC)).toBeNull();
    const dv2 = new FakeDataverse();
    await dv2.create("quotes", create());
    await sendDataverseQuote(dv2, { ...base, docId: null, outcome: "awarded" });
    expect(dv2.quotes).toHaveLength(2);
  });
});
