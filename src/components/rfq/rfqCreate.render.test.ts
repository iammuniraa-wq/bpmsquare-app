import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown; style?: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import RfqComposer, { type ComposerLine } from "./RfqComposer";
import { RfqSendBlocker, RfqSendOutcome } from "./RfqSendNotices";
import { mailboxNotConnected, sendOutcome } from "@/lib/rfq/sendOutcome";

// The RFQ create form after the KAMCO walkthrough of 2026-11-19: twelve BOQ lines are twelve rows, not twelve edit forms, and a
// send that cannot or did not happen is said in words.

const boq = (n: number, include: boolean): ComposerLine => ({ source_line_id: `d${n}`, description: `BOQ item ${n}`, uom: "m", qty: n * 10, include, hint: "no price yet" });
const render = (lines?: ComposerLine[]) => renderToString(createElement(RfqComposer, { compact: true, initialLines: lines, onCreated: () => {} }));

describe("New RFQ form: lines from a record", () => {
  it("shows every line as one row with its tick, description and quantity, and no edit fields", () => {
    const out = render(Array.from({ length: 12 }, (_, i) => boq(i + 1, i === 0)));
    expect((out.match(/data-guide="rfq.line"/g) ?? []).length).toBe(12);
    expect(out).toContain("BOQ item 7");
    expect(out).toMatch(/70<!-- --> ?m|70 m/);
    expect(out).toContain('aria-label="Ask suppliers about line 12"');
    expect(out).not.toContain('aria-label="Line 1 description"');
    expect(out).not.toContain('aria-label="Line 7 specification"');
    expect(out).toContain("(1 of 12 chosen)");
  });

  it("a line from a numbered schedule shows its own item number, not its place in the list", () => {
    const out = render([{ ...boq(1, true), item_no: "1.1", spec: "Item no. 1.1" }, { ...boq(2, true), spec: "Item no. 1.2. Grade 316" }, boq(3, true)]);
    expect(out).toMatch(/data-guide="rfq.line.no"[^>]*>1\.1</);
    expect(out).toMatch(/data-guide="rfq.line.no"[^>]*>1\.2</);
    expect(out).toContain('aria-label="Ask suppliers about line 1.1"');
    expect(out).toContain('aria-label="Edit line 1.2"');
    // A line with no number of its own falls back to its place in the list.
    expect(out).toMatch(/data-guide="rfq.line.no"[^>]*>3</);
  });

  it("the item number is shown only: it is not sent as a field of the line", () => {
    const code = readFileSync(resolve(__dirname, "RfqComposer.tsx"), "utf8");
    expect(code).toContain("item_no: _n");
  });

  it("offers Edit only on a ticked line", () => {
    const out = render([boq(1, true), boq(2, false)]);
    expect(out).toContain('aria-label="Edit line 1"');
    expect(out).not.toContain('aria-label="Edit line 2"');
  });

  it("a line with nothing to send yet starts open", () => {
    const out = render([{ source_line_id: "d1", description: "", include: true }]);
    expect(out).toContain('aria-label="Line 1 description"');
  });

  it("a line typed by hand is always an edit form", () => {
    const out = render();
    expect(out).toContain('aria-label="Line 1 description"');
    expect(out).not.toContain("Ask suppliers about line 1");
  });

  it("offers Send while nothing says the mail channel is down", () => {
    expect(render([boq(1, true)])).toMatch(/Send to[^<]*(<!-- -->)*[^<]*supplier/);
  });

  it("hides Send and promotes Save as draft when the channel cannot send", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/rfq/RfqComposer.tsx"), "utf8");
    expect(src).toContain("{blocker && <RfqSendBlocker reason={blocker} />}");
    expect(src).toContain("{!blocker && <button");
    const single = readFileSync(resolve(process.cwd(), "src/components/rfq/RfqSingleForm.tsx"), "utf8");
    expect(single).toContain("{blocker && <RfqSendBlocker reason={blocker} />}");
    expect(single).toContain("{!blocker && (");
  });
});

describe("RFQ send notices", () => {
  it("the blocker says why, that a draft can be saved, and links to Settings, RFQ", () => {
    const out = renderToString(createElement(RfqSendBlocker, { reason: mailboxNotConnected("gmail") }));
    expect(out).toContain("Gmail connector isn&#x27;t connected");
    expect(out).toContain("save this RFQ as a draft");
    expect(out).toContain('href="/settings/rfq"');
  });

  it("the outcome names the draft, the reason and a link to the RFQ", () => {
    const outcome = sendOutcome("RFQ-0011", [{ supplier: "Alpha", ok: false, reason: mailboxNotConnected("gmail") }], true)!;
    const out = renderToString(createElement(RfqSendOutcome, { rfq: { id: "r11", ref: "RFQ-0011" }, outcome, onStay: () => {} }));
    expect(out).toContain("RFQ-0011 was saved as a draft. Nothing was sent.");
    expect(out).toContain("Gmail connector isn&#x27;t connected");
    expect(out).toContain('href="/rfqs/r11"');
    expect(out).toContain("Open <!-- -->RFQ-0011");
    expect(out).toContain(">Close<");
  });

  it("both create paths show the outcome instead of closing", () => {
    const dialog = readFileSync(resolve(process.cwd(), "src/components/rfq/RfqDialog.tsx"), "utf8");
    expect(dialog).toContain("if (sendOutcome(r.ref, r.sent, r.sendRequested === true)) setUnsent(r);");
    const page = readFileSync(resolve(process.cwd(), "src/app/(app)/rfqs/new/NewRfqForm.tsx"), "utf8");
    expect(page).toContain("if (sendOutcome(r.ref, r.sent, r.sendRequested === true)) setUnsent(r);");
  });
});
