import { describe, expect, it } from "vitest";
import { computeSignals, LARGE_QUOTE_FACTOR } from "./signals";
import { identityOf, isSaudiCrFormat, isSaudiVatFormat, normName, sameCompanyName, websiteDomain, emailDomain, type FieldLabel } from "./identity";
import { LABELS, NOW, RECORDS, SID, identity, othersOf } from "./fixtures";

const find = (r: ReturnType<typeof computeSignals>, id: string) => r.signals.find((s) => s.id === id);

describe("identity from the record", () => {
  it("reads the website, bank, CR and VAT from custom fields by their LABEL, and the tax number from the standard column", () => {
    const wadi = identity(SID.wadi);
    expect(wadi.website).toBe("https://www.wadiprecast.sa");
    expect(wadi.bank).toBe("SA03 8000 0000 6080 1016 7519");
    expect(wadi.cr).toBe("1010123456");
    expect(wadi.taxId).toBe("300123456700003");
  });

  it("a VAT registration number custom field is the tax number, not the CR", () => {
    const labels: FieldLabel[] = [{ field_key: "cf_1", label: "VAT registration number" }, { field_key: "cf_2", label: "Commercial registration no." }];
    const id = identityOf({ ...RECORDS[1], gstin: null, custom_data: { cf_1: "300000000000003", cf_2: "1010000000" } }, labels);
    expect(id.taxId).toBe("300000000000003");
    expect(id.cr).toBe("1010000000");
  });

  it("without any custom field the website, CR and bank are simply absent", () => {
    const id = identity(SID.tihama);
    expect(id.website).toBeNull();
    expect(id.cr).toBeNull();
    expect(id.bank).toBeNull();
  });

  it("normalises names, domains and the Saudi formats", () => {
    expect(sameCompanyName("Wadi Precast Pipes Factory", "WADI PRECAST PIPES CO. LLC")).toBe(true);
    expect(normName("Al Najd Rebar Trading")).toBe("al najd rebar");
    expect(websiteDomain("https://www.Wadiprecast.sa/about")).toBe("wadiprecast.sa");
    expect(emailDomain("Sales@WadiPrecast.sa")).toBe("wadiprecast.sa");
    expect(isSaudiVatFormat("300123456700003")).toBe(true);
    expect(isSaudiVatFormat("3001234567")).toBe(false);
    expect(isSaudiVatFormat("400123456700004")).toBe(false);
    expect(isSaudiCrFormat("1010123456")).toBe(true);
    expect(isSaudiCrFormat("10101234")).toBe(false);
  });
});

describe("genuineness signals", () => {
  it("a consistent record has no risk signals and carries its evidence: matching domain and well-formed numbers, labelled format only", () => {
    const r = computeSignals(identity(SID.wadi), othersOf(SID.wadi), { now: NOW });
    expect(r.signals.filter((s) => s.severity === "high" || s.severity === "medium")).toEqual([]);
    expect(r.positives.map((p) => p.id).sort()).toEqual(["cr_format", "domain_match", "vat_format"]);
    expect(r.positives.find((p) => p.id === "vat_format")?.text).toMatch(/format only, not confirmed with the registry/i);
  });

  it("a free-mail address on a company supplier is a low signal that names the service", () => {
    const s = find(computeSignals(identity(SID.dune), othersOf(SID.dune), { now: NOW }), "free_mail");
    expect(s?.severity).toBe("low");
    expect(s?.text).toContain("gmail.com");
  });

  it("a VAT number in digits that is not the Saudi format is flagged as a format finding only; an alphanumeric one is another scheme and is left alone", () => {
    const bad = find(computeSignals(identity(SID.dune), othersOf(SID.dune), { now: NOW }), "vat_format");
    expect(bad?.severity).toBe("medium");
    expect(bad?.formatOnly).toBe(true);
    const gst = { ...identity(SID.dune), taxId: "22AAAAA0000A1Z5" };
    expect(find(computeSignals(gst, othersOf(SID.dune), { now: NOW }), "vat_format")).toBeUndefined();
  });

  it("the same bank details under a different company name is a HIGH signal naming the other supplier, and never prints the bank number", () => {
    const r = computeSignals(identity(SID.najd), othersOf(SID.najd), { now: NOW });
    const dup = find(r, "dup_bank");
    expect(dup?.severity).toBe("high");
    expect(dup?.with).toEqual([{ id: SID.arkan, name: "Arkan Waterproofing Systems" }]);
    expect(dup?.text).not.toMatch(/SA44|2000|6789/);
    const mirror = find(computeSignals(identity(SID.arkan), othersOf(SID.arkan), { now: NOW }), "dup_bank");
    expect(mirror?.with?.[0].name).toBe("Al Najd Rebar Trading");
  });

  it("the same number under the same company name reads as a record entered twice, not as a red flag", () => {
    const twin = { ...identity(SID.wadi), id: "twin", name: "Wadi Precast Pipes Co. LLC" };
    const r = computeSignals(twin, [identity(SID.wadi)], { now: NOW });
    expect(find(r, "dup_bank")).toBeUndefined();
    expect(find(r, "dup_bank_record")?.severity).toBe("medium");
    expect(find(r, "dup_bank_record")?.text).toMatch(/entered twice/);
  });

  it("a duplicate tax or registration number under another name is high, a shared email medium, a shared phone low", () => {
    const base = identity(SID.tihama);
    const other = { ...identity(SID.sahra), taxId: "300111111100003", cr: "1010555555", email: "x@shared.sa", phone: "0555 000 111" };
    const subject = { ...base, taxId: "300111111100003", cr: "1010555555", email: "x@shared.sa" };
    const r = computeSignals(subject, [other], { now: NOW });
    expect(find(r, "dup_tax_id")?.severity).toBe("high");
    expect(find(r, "dup_cr")?.severity).toBe("high");
    expect(find(r, "dup_email")?.severity).toBe("medium");
    expect(find(r, "dup_phone")?.severity).toBe("low");
  });

  it("an email domain that does not match the website is medium; a match is evidence", () => {
    const s = { ...identity(SID.arkan), email: "tenders@elsewhere.com" };
    expect(find(computeSignals(s, othersOf(SID.arkan), { now: NOW }), "email_site_mismatch")?.severity).toBe("medium");
    const ok = computeSignals(identity(SID.arkan), othersOf(SID.arkan), { now: NOW });
    expect(ok.positives.some((p) => p.id === "domain_match")).toBe(true);
  });

  it("no website is a low signal; no contact at all is medium; a record with no CR gets an information note", () => {
    const r = computeSignals(identity(SID.tihama), othersOf(SID.tihama), { now: NOW });
    expect(find(r, "no_website")?.severity).toBe("low");
    expect(find(r, "no_cr")?.severity).toBe("info");
    const bare = { ...identity(SID.tihama), email: null, phone: null };
    expect(find(computeSignals(bare, othersOf(SID.tihama), { now: NOW }), "no_contact")?.severity).toBe("medium");
  });

  it("a brand-new supplier whose largest quote is far above the usual one is flagged, only with enough peers and only while new", () => {
    const peers = [1000, 1200, 900, 1100];
    const q = { subjectTotal: 1100 * LARGE_QUOTE_FACTOR, peerTotals: peers };
    const r = computeSignals(identity(SID.sahra), othersOf(SID.sahra), { now: NOW, quote: q, formatMoney: (n) => `SAR ${Math.round(n)}` });
    const s = find(r, "new_large_quote");
    expect(s?.severity).toBe("medium");
    expect(s?.text).toMatch(/added 37 days ago/);
    expect(find(computeSignals(identity(SID.sahra), othersOf(SID.sahra), { now: NOW, quote: { ...q, peerTotals: [1000, 1200] } }), "new_large_quote")).toBeUndefined();
    expect(find(computeSignals(identity(SID.wadi), othersOf(SID.wadi), { now: NOW, quote: q }), "new_large_quote")).toBeUndefined();
    expect(find(computeSignals(identity(SID.sahra), othersOf(SID.sahra), { now: NOW, quote: { ...q, subjectTotal: 2000 } }), "new_large_quote")).toBeUndefined();
  });

  it("orders the most serious first and never carries a contact detail in a sentence", () => {
    const r = computeSignals(identity(SID.najd), othersOf(SID.najd), { now: NOW });
    const order = { high: 0, medium: 1, low: 2, info: 3 } as const;
    const ranks = r.signals.map((s) => order[s.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    for (const s of r.signals) expect(s.text).not.toMatch(/@|\+?\d{9,}/);
  });
});
