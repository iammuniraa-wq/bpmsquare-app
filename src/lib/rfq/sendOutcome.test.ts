import { describe, it, expect } from "vitest";
import { mailboxNotConnected, sendOutcome } from "./sendOutcome";
import { buildMessageEmail, buildRequestEmail, buildRfqDocumentHtml, signatureLines, type SupplierView } from "./compose";

describe("sendOutcome", () => {
  const blocked = mailboxNotConnected("gmail");

  it("says nothing when no send was asked for, or it reached everyone", () => {
    expect(sendOutcome("RFQ-0011", undefined, false)).toBeNull();
    expect(sendOutcome("RFQ-0011", [{ supplier: "A", ok: true }, { supplier: "B", ok: true }], true)).toBeNull();
  });

  it("a send that reached nobody is a saved draft, with the reason once", () => {
    const o = sendOutcome("RFQ-0011", [{ supplier: "A", ok: false, reason: blocked }, { supplier: "B", ok: false, reason: blocked }], true)!;
    expect(o.nothingSent).toBe(true);
    expect(o.headline).toBe("RFQ-0011 was saved as a draft. Nothing was sent.");
    expect(o.reasons).toEqual([blocked]);
    expect(blocked).toBe("RFQ email is set to go from your own mailbox, but the Gmail connector isn't connected (Settings → Connectors).");
    expect(mailboxNotConnected("mail_server")).toContain("Mail server connector");
  });

  it("a send that reached some names who was missed and why", () => {
    const o = sendOutcome("RFQ-0012", [{ supplier: "A", ok: true }, { supplier: "B", ok: false, reason: "B has no valid email address." }, { supplier: "C", ok: false, reason: "Send failed: timeout" }], true)!;
    expect(o.nothingSent).toBe(false);
    expect(o.headline).toBe("RFQ-0012 was sent to 1 of 3 suppliers. 2 were not sent.");
    expect(o.reasons).toEqual(["B: B has no valid email address.", "C: Send failed: timeout"]);
  });

  it("a send that was asked for and came back with no result is still not a success", () => {
    const o = sendOutcome("RFQ-0013", undefined, true)!;
    expect(o.nothingSent).toBe(true);
    expect(o.reasons).toHaveLength(1);
    expect(sendOutcome("RFQ-0013", [{ supplier: "A", ok: false }], true)!.reasons[0]).toMatch(/could not be sent/);
  });
});

describe("the RFQ signature", () => {
  const view = (over: Partial<SupplierView> = {}): SupplierView => ({
    tenantName: "KAMCO", ref: "RFQ-0011", title: "Pipes", respondBy: null, requiredBy: null, deliveryTerms: null, notesToSupplier: null, terms: null,
    supplierName: "Alpha", buyerName: null, buyerEmail: "buyer@kamco.test", lines: [{ id: "l1", sl_no: 1, description: "Pipe", spec: null, uom: "m", qty: 10, required_by: null }], ...over,
  });
  const count = (s: string, needle: string) => s.split(needle).length - 1;

  it("prints the company once when there is no buyer name", () => {
    expect(signatureLines(view())).toEqual(["KAMCO", "buyer@kamco.test"]);
    expect(signatureLines(view({ buyerName: " kamco " }))).toEqual(["KAMCO", "buyer@kamco.test"]);
    const mail = buildRequestEmail(view(), { link: null, code: null });
    expect(mail.text.endsWith("Regards,\nKAMCO\nbuyer@kamco.test")).toBe(true);
    expect(mail.html).toContain("<p>Regards,<br>KAMCO<br>buyer@kamco.test</p>");
    const msg = buildMessageEmail(view(), null, "Any news?", null);
    expect(msg.text.endsWith("Regards,\nKAMCO")).toBe(true);
    expect(msg.html).toContain("<p>Regards,<br>KAMCO</p>");
    const pdf = buildRfqDocumentHtml(view(), { logoUrl: null, issuedOn: "2026-11-19" });
    expect(pdf).toContain("<footer>KAMCO · buyer@kamco.test</footer>");
  });

  it("prints the buyer, then the company, when the buyer is known", () => {
    const v = view({ buyerName: "Rashid <Buyer>" });
    expect(signatureLines(v)).toEqual(["Rashid <Buyer>", "KAMCO", "buyer@kamco.test"]);
    const mail = buildRequestEmail(v, { link: null, code: null });
    expect(mail.text.endsWith("Regards,\nRashid <Buyer>\nKAMCO\nbuyer@kamco.test")).toBe(true);
    expect(mail.html).toContain("<p>Regards,<br>Rashid &lt;Buyer&gt;<br>KAMCO<br>buyer@kamco.test</p>");
    expect(count(mail.text.slice(mail.text.indexOf("Regards,")), "KAMCO")).toBe(1);
    expect(buildRfqDocumentHtml(v, { logoUrl: null, issuedOn: "2026-11-19" })).toContain("<footer>Rashid &lt;Buyer&gt; · KAMCO · buyer@kamco.test</footer>");
  });
});
