import { identityOf, type FieldLabel, type Identity, type SupplierRecord } from "./identity";
import type { RatingLine, RatingResponse, RatingRfqSupplier } from "./rating";

// A workspace of six suppliers for the tests, shaped like a contractor's: one with strong history and a consistent record, one with a
// free-mail address, one that shares bank details with another under a different name, one that is new, and one that is thin (the kind
// a demo workspace holds: no website, a made-up email, two RFQs). The same ids are used by the service tests.

export const NOW = new Date("2026-11-26T09:00:00Z");

export const LABELS: FieldLabel[] = [
  { field_key: "cf_website", label: "Website" },
  { field_key: "cf_bank", label: "Bank account (IBAN)" },
  { field_key: "cf_cr", label: "Commercial registration no." },
  { field_key: "cf_vat", label: "VAT registration number" },
];

export const SID = { wadi: "00000000-0000-4000-8000-0000000000a1", tihama: "00000000-0000-4000-8000-0000000000a2", arkan: "00000000-0000-4000-8000-0000000000a3", dune: "00000000-0000-4000-8000-0000000000a4", najd: "00000000-0000-4000-8000-0000000000a5", sahra: "00000000-0000-4000-8000-0000000000a6" } as const;

const rec = (id: string, name: string, over: Partial<SupplierRecord> = {}): SupplierRecord => ({
  id, name, type: "vendor", status: "active", email: null, phone: null, gstin: null, notes: null, custom_data: null, created_at: "2025-01-10T00:00:00Z", ...over,
});

export const RECORDS: SupplierRecord[] = [
  rec(SID.wadi, "Wadi Precast Pipes Factory", {
    email: "sales@wadiprecast.sa", phone: "+966 11 400 1234", gstin: "300123456700003",
    custom_data: { cf_website: "https://www.wadiprecast.sa", cf_cr: "1010123456", cf_bank: "SA03 8000 0000 6080 1016 7519" },
  }),
  rec(SID.tihama, "Tihama Geosynthetics", { email: "info@tihama-geo.sa", phone: "0555 000 111", created_at: "2026-03-01T00:00:00Z" }),
  rec(SID.arkan, "Arkan Waterproofing Systems", {
    email: "tenders@arkanwp.sa", phone: "0560 222 333", gstin: "300765432100003",
    custom_data: { cf_website: "arkanwp.sa", cf_bank: "SA44 2000 0001 2345 6789 1234" },
  }),
  rec(SID.dune, "Dune Readymix Co", { email: "dune.readymix@gmail.com", phone: "0561 444 555", gstin: "12345" }),
  rec(SID.najd, "Al Najd Rebar Trading", {
    email: "accounts@najdrebar.sa", phone: "0562 666 777", gstin: "300998877600003",
    custom_data: { cf_bank: "SA44 2000 0001 2345 6789 1234", cf_cr: "1010999888" },
  }),
  rec(SID.sahra, "Sahra Aggregates and Fill", { email: "office@sahra-agg.sa", phone: "0563 888 999", created_at: "2026-10-20T00:00:00Z" }),
];

export const identities = (labels: readonly FieldLabel[] = LABELS): Identity[] => RECORDS.map((r) => identityOf(r, labels));
export const identity = (id: string): Identity => identities().find((i) => i.id === id) as Identity;
export const othersOf = (id: string): Identity[] => identities().filter((i) => i.id !== id);

const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** Six RFQs, two lines each. Wadi quotes everything, fast, cheapest, with a validity date, and wins line 1 of the first three. Tihama is asked on two. */
export function history(): { rfqSuppliers: RatingRfqSupplier[]; lines: RatingLine[]; responses: RatingResponse[] } {
  const rfqSuppliers: RatingRfqSupplier[] = [];
  const lines: RatingLine[] = [];
  const responses: RatingResponse[] = [];
  const quote = (rs: string, line: string, price: number, over: Partial<RatingResponse> = {}, sentDays = 60): RatingResponse => ({
    id: `resp-${rs}-${line}`, rfq_supplier_id: rs, rfq_line_id: line, status: "quoted", unit_price: price, fx_rate: null,
    valid_until: "2027-03-31", submitted_at: day(sentDays - 1), is_awarded: false, ...over,
  });
  for (let i = 1; i <= 6; i++) {
    const rfq = `rfq-${i}`;
    const sent = 300 - i * 40;
    lines.push({ id: `${rfq}-l1`, rfq_id: rfq, status: "open" }, { id: `${rfq}-l2`, rfq_id: rfq, status: "open" });
    const add = (rs: string, supplier: string, status: string, repliedAfterH: number | null) =>
      rfqSuppliers.push({ id: rs, rfq_id: rfq, supplier_id: supplier, status, sent_at: day(sent), replied_at: repliedAfterH === null ? null : new Date(Date.parse(day(sent)) + repliedAfterH * 3_600_000).toISOString() });
    add(`${rfq}-wadi`, SID.wadi, "replied", 20);
    add(`${rfq}-arkan`, SID.arkan, "replied", 90);
    add(`${rfq}-najd`, SID.najd, "replied", 150);
    responses.push(
      quote(`${rfq}-wadi`, `${rfq}-l1`, 100, { is_awarded: i <= 3, submitted_at: day(sent - 1) }), quote(`${rfq}-wadi`, `${rfq}-l2`, 50, { submitted_at: day(sent - 1) }),
      quote(`${rfq}-arkan`, `${rfq}-l1`, 110, { valid_until: null, submitted_at: day(sent - 3) }), quote(`${rfq}-arkan`, `${rfq}-l2`, 56, { valid_until: null, submitted_at: day(sent - 3) }),
      quote(`${rfq}-najd`, `${rfq}-l1`, 120, { valid_until: null, submitted_at: day(sent - 6) }), quote(`${rfq}-najd`, `${rfq}-l2`, 60, { valid_until: null, submitted_at: day(sent - 6) }),
    );
    if (i === 1) {
      add(`${rfq}-tihama`, SID.tihama, "replied", 70);
      responses.push(quote(`${rfq}-tihama`, `${rfq}-l1`, 130, { submitted_at: day(sent - 3) }));
    }
    if (i === 2) add(`${rfq}-tihama`, SID.tihama, "declined", 30);
  }
  return { rfqSuppliers, lines, responses };
}
