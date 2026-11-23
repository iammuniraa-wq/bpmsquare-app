import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { tipTextProblems } from "@/lib/infoTip";
import { REVISION_TIPS } from "./tips";
import {
  canEditContent, isLockedByIssue, lockedKeysIn, printedRevisionNo, reasonProblem, revisionColumnsReady, revisionsActive, revisionsOn, workingRevisionNo,
} from "./state";
import { buildStandardQuoteSnapshot, describeDiff, diffSnapshots, readSnapshot, snapshotForPrint } from "./snapshot";

vi.mock("@/lib/changeLog", () => ({ logChange: vi.fn(async () => {}) }));
process.env.FIELD_ENCRYPTION_KEY = "00".repeat(32);
const { issueStandardQuote, reviseStandardQuote, openPii, loadRevisionSnapshot } = await import("./server");
const { logChange } = await import("@/lib/changeLog");
const { encrypt } = await import("@/lib/encryption");

const T = "t1";
const money = (n: number) => `SAR ${n}`;

describe("the switch and the lock", () => {
  it("is off unless a workspace turns it on, and a pending migration counts as off", () => {
    expect(revisionsOn(undefined)).toBe(false);
    expect(revisionsOn({})).toBe(false);
    expect(revisionsOn({ revisions: { standard_quote: false } })).toBe(false);
    expect(revisionsOn({ revisions: { standard_quote: true } })).toBe(true);
    expect(revisionColumnsReady({ ref: "x" })).toBe(false);
    expect(revisionColumnsReady({ revision_state: null })).toBe(true);
    expect(revisionsActive({ revisions: { standard_quote: true } }, { ref: "x" })).toBe(false);
    expect(revisionsActive({ revisions: { standard_quote: true } }, { revision_state: null })).toBe(true);
  });

  it("off = today's rule exactly: only a draft is editable, nothing is ever locked", () => {
    expect(canEditContent({ status: "draft" }, false)).toBe(true);
    expect(canEditContent({ status: "sent" }, false)).toBe(false);
    expect(isLockedByIssue({ revision_state: "issued" }, false)).toBe(false);
  });

  it("on: an issued quotation is read-only, a revised one is editable again, an accepted one never", () => {
    expect(canEditContent({ status: "draft", revision_state: null }, true)).toBe(true);
    expect(canEditContent({ status: "draft", revision_state: "issued" }, true)).toBe(false);
    expect(canEditContent({ status: "sent", revision_state: "draft" }, true)).toBe(true);
    expect(canEditContent({ status: "accepted", revision_state: "draft" }, true)).toBe(false);
    expect(isLockedByIssue({ revision_state: "issued" }, true)).toBe(true);
  });

  it("numbers revisions 00, 01, 02: the working copy is the next one until it is issued", () => {
    expect(workingRevisionNo({ current_revision: null, revision_state: null })).toBe(0);
    expect(workingRevisionNo({ current_revision: 0, revision_state: "issued" })).toBe(0);
    expect(workingRevisionNo({ current_revision: 0, revision_state: "draft" })).toBe(1);
    expect(workingRevisionNo({ current_revision: 3, revision_state: "draft" })).toBe(4);
    expect(printedRevisionNo({ current_revision: 2, revision_state: "issued" })).toBe(2);
    expect(printedRevisionNo({ current_revision: 2, revision_state: "draft" })).toBe(3);
  });

  it("needs no reason for Rev. 00 and a real one from Rev. 01", () => {
    expect(reasonProblem(0, "")).toBeNull();
    expect(reasonProblem(1, "")).toMatch(/why/);
    expect(reasonProblem(1, "ab")).toMatch(/why/);
    expect(reasonProblem(2, "Client added 50 pieces")).toBeNull();
    expect(reasonProblem(2, "x".repeat(1001))).toMatch(/1000/);
  });

  it("names the content a locked quote refuses and leaves status and the deal link open", () => {
    expect(lockedKeysIn({ status: "sent", sent_at: "x", opportunity_id: "o" })).toEqual([]);
    expect(lockedKeysIn({ lines: [], terms: "x", status: "sent" }).sort()).toEqual(["lines", "terms"]);
    expect(lockedKeysIn({ doc_sections: {}, entity_id: "e", project_title: "p" })).toHaveLength(3);
  });

  it("holds every revision text to the tip limit", () => {
    for (const [k, v] of Object.entries(REVISION_TIPS)) expect(tipTextProblems(v), k).toEqual([]);
  });
});

const quoteRow = (over: Row = {}): Row => ({
  id: "q1", tenant_id: T, ref: "167 / 2026", account_id: "a1", contact_id: "c1", status: "draft", template_id: null, entity_id: "e1",
  created_at: "2026-08-10T12:00:00Z", valid_until: "2026-09-30", inquiry_date: null, terms: "Terms", notes: "n", intro_text: null,
  header_discount_pct: 0, tax_pct: 0, shipping_amount: 0, subtotal: 1000, total: 1000, project_title: "P", subject: "S", doc_sections: { x: 1 },
  custom_data: null, print_options: null, current_revision: null, revision_state: null, pending_revision_reason: null,
  // things that must NEVER reach a snapshot
  created_by: "u-secret", cost_total: 700, margin_pct: 30, ...over,
});
const lineRow = (n: number, over: Row = {}): Row => ({
  id: `l${n}`, tenant_id: T, standard_quote_id: "q1", sl_no: String(n), description: `Item ${n}`, uom: "No's", qty: 2, rate: 500, discount_pct: 0, amount: 1000,
  is_selected: true, show_on_pdf: true, group_id: null, group_label: null, group_type: null, break_of: null, break_qty: null,
  // internal columns that must NEVER reach a snapshot
  pricing_flags: [{ code: "MARGIN_FLOOR", floor_pct: 15, actual_pct: 12, policy: "warn" }], pricing_document_id: "pd1", rfq_line_id: "rl1", cost: 400, ...over,
});

const seed = (over: Record<string, Row[]> = {}) => ({
  tenants: [{ id: T, name: "Acme", logo_url: null, company_info: { name: "Acme", web: "acme.test" }, config: { revisions: { standard_quote: true }, pdf_design: { page: { size: "A4" } }, entities: [{ id: "e1", name: "Acme Ltd", short_name: "AC", address: "x", is_default: true }] } }],
  standard_quotes: [quoteRow()], standard_quote_lines: [lineRow(1)],
  accounts: [{ id: "a1", tenant_id: T, name: "Customer", city: "Dammam", phone: encrypt("+966 1"), email: encrypt("c@x.test"), print_ids: ["v1"] }],
  contacts: [{ id: "c1", tenant_id: T, name: "Haidi", phone: encrypt("+966 53"), email: encrypt("h@x.test") }],
  document_revisions: [], ...over,
});
const actor = { id: "u1", email: "u@x.test" };

beforeEach(() => { vi.mocked(logChange).mockClear(); });

describe("issue", () => {
  it("writes Rev. 00 as an immutable snapshot, marks the quotation issued and logs it", async () => {
    const db = fakeDb(seed());
    const r = await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor });
    expect(r).toEqual({ ok: true, revision_no: 0 });
    const rev = db.tables["document_revisions"][0];
    expect(rev).toMatchObject({ tenant_id: T, object_type: "standard_quote", object_id: "q1", revision_no: 0, issued_by: "u1", total: 1000, currency: "INR" });
    expect(db.tables["standard_quotes"][0]).toMatchObject({ current_revision: 0, revision_state: "issued", pending_revision_reason: null });
    expect(logChange).toHaveBeenCalledOnce();
  });

  it("freezes what was printed and NEVER a cost, a margin, a flag or an author", async () => {
    const db = fakeDb(seed());
    await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor });
    const json = JSON.stringify(db.tables["document_revisions"][0].snapshot);
    for (const forbidden of ["u-secret", "cost_total", "margin_pct", "pricing_flags", "MARGIN_FLOOR", "pricing_document_id", "rfq_line_id", "\"cost\"", "pd1", "rl1"]) expect(json, forbidden).not.toContain(forbidden);
    const snap = readSnapshot(db.tables["document_revisions"][0].snapshot)!;
    expect(snap.quote).toMatchObject({ ref: "167 / 2026", project_title: "P", subject: "S", total: 1000 });
    expect(snap.lines[0]).toMatchObject({ description: "Item 1", qty: 2, rate: 500, amount: 1000 });
    expect(snap.frame.entity?.name).toBe("Acme Ltd");
    expect(snap.frame.print_ids).toEqual(["v1"]);
    expect(snap.template.blocks.length).toBeGreaterThan(0);
  });

  it("keeps the customer's phone and email sealed in the snapshot, readable only through openPii", async () => {
    const db = fakeDb(seed());
    await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor });
    const raw = JSON.stringify(db.tables["document_revisions"][0].snapshot);
    expect(raw).not.toContain("+966 1");
    expect(raw).not.toContain("c@x.test");
    expect(raw).not.toContain("h@x.test");
    const opened = openPii(readSnapshot(db.tables["document_revisions"][0].snapshot)!);
    expect(opened.account?.phone).toBe("+966 1");
    expect(opened.contact?.email).toBe("h@x.test");
    const loaded = await loadRevisionSnapshot(db.client, T, "q1", 0);
    expect(loaded?.snapshot.account?.email).toBe("c@x.test");
  });

  it("refuses a second issue of the same working copy, an empty quotation, and a workspace without the switch", async () => {
    const db = fakeDb(seed());
    await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor });
    const again = await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor });
    expect(again).toMatchObject({ ok: false, status: 409 });
    expect(db.tables["document_revisions"]).toHaveLength(1);

    const empty = fakeDb(seed({ standard_quote_lines: [] }));
    expect(await issueStandardQuote(empty.client, empty.client, { tenantId: T, quoteId: "q1", actor })).toMatchObject({ ok: false, status: 422 });

    const off = seed();
    (off.tenants[0].config as Record<string, unknown>).revisions = { standard_quote: false };
    const dbOff = fakeDb(off);
    expect(await issueStandardQuote(dbOff.client, dbOff.client, { tenantId: T, quoteId: "q1", actor })).toMatchObject({ ok: false, status: 409 });
    expect(dbOff.tables["document_revisions"]).toHaveLength(0);
  });

  it("never reads or writes another workspace's quotation", async () => {
    const db = fakeDb(seed({ standard_quotes: [quoteRow({ tenant_id: "t2" })] }));
    expect(await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor })).toMatchObject({ ok: false, status: 404 });
    expect(db.tables["document_revisions"]).toHaveLength(0);
  });

  it("says a database update is needed while 0252 is pending, and changes nothing", async () => {
    const noCols = seed();
    const q = noCols.standard_quotes[0];
    delete q.revision_state; delete q.current_revision; delete q.pending_revision_reason;
    const db = fakeDb(noCols);
    const r = await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor });
    expect(r).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("0252") });
    const noTable = fakeDb(seed(), { missingTables: ["document_revisions"] });
    const r2 = await issueStandardQuote(noTable.client, noTable.client, { tenantId: T, quoteId: "q1", actor });
    expect(r2).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("0252") });
    expect(noTable.tables["standard_quotes"][0].revision_state).toBeNull();
  });

  it("answers a lost race (unique key) with a clear message and leaves the quotation as it was", async () => {
    const db = fakeDb(seed());
    const real = db.client.from.bind(db.client);
    const racing = { ...db.client, from: (t: string) => {
      const q = real(t) as unknown as { insert: (r: unknown) => unknown };
      if (t !== "document_revisions") return q;
      return { ...q, insert: () => ({ then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } }).then(res) }) };
    } } as never;
    const r = await issueStandardQuote(racing, racing, { tenantId: T, quoteId: "q1", actor });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(db.tables["standard_quotes"][0].revision_state).toBeNull();
  });
});

describe("revise", () => {
  it("reopens an issued quotation as the next revision, keeps the reason, and the issued revision stays as it was", async () => {
    const db = fakeDb(seed());
    await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor });
    const before = JSON.stringify(db.tables["document_revisions"][0]);
    const r = await reviseStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", reason: "Client added 50 pieces", actor });
    expect(r).toEqual({ ok: true, working_revision: 1 });
    expect(db.tables["standard_quotes"][0]).toMatchObject({ revision_state: "draft", current_revision: 0, pending_revision_reason: "Client added 50 pieces" });
    expect(JSON.stringify(db.tables["document_revisions"][0])).toBe(before);
  });

  it("then issues Rev. 01 with that reason; a revision without a reason is refused", async () => {
    const db = fakeDb(seed());
    await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor });
    expect(await reviseStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", reason: "", actor })).toMatchObject({ ok: false, status: 422 });
    await reviseStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", reason: "Client added 50 pieces", actor });
    db.tables["standard_quote_lines"][0].rate = 520;
    db.tables["standard_quotes"][0].total = 1040;
    const r = await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor });
    expect(r).toEqual({ ok: true, revision_no: 1 });
    const revs = db.tables["document_revisions"];
    expect(revs).toHaveLength(2);
    expect(revs[1]).toMatchObject({ revision_no: 1, reason: "Client added 50 pieces", total: 1040 });
    expect(revs[0]).toMatchObject({ revision_no: 0, total: 1000 });
    expect(db.tables["standard_quotes"][0]).toMatchObject({ current_revision: 1, revision_state: "issued", pending_revision_reason: null });
  });

  it("refuses to revise what is not issued, and an accepted quotation", async () => {
    const db = fakeDb(seed());
    expect(await reviseStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", reason: "because", actor })).toMatchObject({ ok: false, status: 409 });
    await issueStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", actor });
    db.tables["standard_quotes"][0].status = "accepted";
    expect(await reviseStandardQuote(db.client, db.client, { tenantId: T, quoteId: "q1", reason: "because", actor })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("snapshot and history", () => {
  const snap = (lines: Row[], total: number) => buildStandardQuoteSnapshot({
    quote: quoteRow({ total }), lines, account: null, contact: null,
    template: { id: null, name: null, accent_color: null, logo_position: "left", blocks: [] },
    frame: { design: null, entity: null, company_info: {}, tenant_name: "Acme", logo_url: null, print_ids: [] }, currency: "SAR",
  });

  it("tells what changed between two revisions in words", () => {
    const a = snap([lineRow(1), lineRow(2)], 2000);
    const b = snap([lineRow(1, { rate: 520, amount: 1040 }), lineRow(3)], 2540);
    const d = diffSnapshots(a, b);
    expect(d).toEqual({ totalDelta: 540, added: 1, removed: 1, changed: 1 });
    expect(describeDiff(d, money)).toBe("+SAR 540, 1 added, 1 removed, 1 re-priced");
    expect(describeDiff(diffSnapshots(a, a), money)).toBe("No change in lines or total");
    expect(diffSnapshots(null, a)).toMatchObject({ added: 2, totalDelta: 2000 });
  });

  it("rejects anything that is not a version-1 snapshot, and rebuilds print records from one", () => {
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot({ v: 2 })).toBeNull();
    const s = snap([lineRow(1)], 1000);
    expect(readSnapshot(s)).not.toBeNull();
    const p = snapshotForPrint(s, { quoteId: "q1", tenantId: T, status: "sent" });
    expect(p.quote.ref).toBe("167 / 2026");
    expect(p.quote.status).toBe("sent");
    expect(p.lines[0].description).toBe("Item 1");
  });
});
