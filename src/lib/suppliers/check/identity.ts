// What a supplier record says about who the company is, read out of its standard columns and the workspace's own custom fields.
// Pure. A supplier has no website, registration or bank column of its own: a workspace that keeps them has added custom fields, so
// a field is recognised by its LABEL (the label the workspace gave it), never by a key the code invented.

export type SupplierRecord = {
  id: string;
  name: string;
  type?: string | null;
  status?: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  notes?: string | null;
  custom_data: Record<string, unknown> | null;
  created_at: string;
};

export type FieldLabel = { field_key: string; label: string };

export type Identity = {
  id: string;
  name: string;
  status: string | null;
  createdAt: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  cr: string | null;
  website: string | null;
  bank: string | null;
};

const text = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t : null;
};

const LABEL_RULES: { slot: "website" | "bank" | "cr" | "taxId"; test: RegExp }[] = [
  { slot: "website", test: /\b(website|web ?site|web ?page|homepage|url)\b/i },
  { slot: "bank", test: /\b(iban|bank|account (?:no|number|num)|swift)\b/i },
  { slot: "taxId", test: /\b(vat|tax (?:id|no|number|reg\w*)|trn|gstin|tin)\b/i },
  { slot: "cr", test: /(commercial reg|company reg|trade licen|\bc\.?r\.?\b|\bcr ?(?:no|number|num)?\b|registration (?:no|number))/i },
];

/** Reads the identity slots from a supplier record. The standard `gstin` column is the tax number; custom fields fill the rest by label. */
export function identityOf(rec: SupplierRecord, labels: readonly FieldLabel[]): Identity {
  const slots: Partial<Record<"website" | "bank" | "cr" | "taxId", string>> = {};
  const data = rec.custom_data ?? {};
  for (const l of labels) {
    const v = text(data[l.field_key]);
    if (!v) continue;
    const rule = LABEL_RULES.find((r) => r.test.test(l.label));
    if (rule && !slots[rule.slot]) slots[rule.slot] = v;
  }
  return {
    id: rec.id, name: rec.name, status: rec.status ?? null, createdAt: rec.created_at,
    email: text(rec.email), phone: text(rec.phone),
    taxId: text(rec.gstin) ?? slots.taxId ?? null,
    cr: slots.cr ?? null, website: slots.website ?? null, bank: slots.bank ?? null,
  };
}

export const digitsOf = (v: string | null): string => (v ?? "").replace(/\D+/g, "");

/** The comparison form of an email: lower case. */
export const normEmail = (v: string | null): string => (v ?? "").trim().toLowerCase();

/** The comparison form of a phone: the last nine digits, which is the national number in the Gulf and survives +966 / 00966 / 0. */
export function normPhone(v: string | null): string {
  const d = digitsOf(v);
  return d.length >= 7 ? d.slice(-9) : "";
}

/** The comparison form of a bank account: letters and digits, upper case. Too short to mean anything is nothing. */
export function normBank(v: string | null): string {
  const s = (v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return s.length >= 8 ? s : "";
}

export const normNumber = (v: string | null): string => {
  const s = (v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return s.length >= 6 ? s : "";
};

export function emailDomain(email: string | null): string | null {
  const m = /@([^@\s]+)$/.exec(normEmail(email));
  return m ? m[1].replace(/^www\./, "") : null;
}

export function websiteDomain(site: string | null): string | null {
  const s = (site ?? "").trim().toLowerCase();
  if (!s) return null;
  const host = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
  return host && host.includes(".") ? host : null;
}

const COMPANY_WORDS = new Set([
  "llc", "ltd", "limited", "co", "company", "corp", "corporation", "inc", "est", "establishment", "trading", "factory", "group", "holding",
  "international", "intl", "the", "and", "for", "of", "wll", "fze", "fzc", "pvt", "private", "jsc", "saog", "sa", "ksa", "saudi",
]);

/** The comparison form of a company name, so "Wadi Precast Pipes Factory" and "Wadi Precast Pipes Co. LLC" read as the same name. */
export function normName(v: string): string {
  return (v.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !COMPANY_WORDS.has(w)).join(" ");
}

/** Two names that are the same company written two ways: equal once the legal words are gone. */
export const sameCompanyName = (a: string, b: string): boolean => {
  const x = normName(a);
  const y = normName(b);
  return x.length > 0 && x === y;
};

export const FREE_MAIL: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "ymail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com",
  "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "mail.com", "gmx.com", "yandex.com", "qq.com", "163.com", "rediffmail.com",
]);

export const DISPOSABLE_MAIL: ReadonlySet<string> = new Set([
  "mailinator.com", "guerrillamail.com", "tempmail.com", "10minutemail.com", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com",
]);

/** A Saudi VAT number: 15 digits, starting and ending with 3. A format test only; nothing here asks the registry. */
export const isSaudiVatFormat = (v: string | null): boolean => /^3\d{13}3$/.test(digitsOf(v));

/** A Saudi commercial registration number: 10 digits. A format test only. */
export const isSaudiCrFormat = (v: string | null): boolean => /^\d{10}$/.test(digitsOf(v));

/** The number is written as digits (with spaces or dashes), so the Saudi format test applies; an alphanumeric number is another country's scheme. */
export const looksNumeric = (v: string | null): boolean => !!v && /^[\d\s-]+$/.test(v.trim());
