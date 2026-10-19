// Jurisdiction rules for marketing consent (docs/marketing-platform-
// architecture.md 1.3). This is DATA, not law: the product records the basis
// it was given and refuses to send when the basis for the person's
// jurisdiction is missing. A lawyer reviews this table before any tenant goes
// live (open question 3 in that doc).
//
// Every default is the STRICT one -- opt-in required. A tenant's admin may
// relax it per jurisdiction in Settings -> Marketing -> Consent, but only where
// the rule below says an existing-customer basis is recognised at all.

export const JURISDICTIONS = ["SA", "AE", "QA", "KW", "OM", "BH", "IN", "EU", "other"] as const;
export type JurisdictionCode = (typeof JURISDICTIONS)[number];

/** What a tenant chooses for people it has no ledger entry for. */
export type ConsentBasisSetting = "consent_required" | "existing_customer";

export type JurisdictionRule = {
  code: JurisdictionCode;
  label: string;
  /** Can an existing customer be emailed about similar products without a fresh opt-in? */
  existingCustomerAllowed: boolean;
  /** The plain sentence shown beside the choice in Settings. */
  plain: string;
};

export const JURISDICTION_RULES: Record<JurisdictionCode, JurisdictionRule> = {
  SA: {
    code: "SA", label: "Saudi Arabia", existingCustomerAllowed: true,
    plain: "Under the Saudi data protection law, marketing needs the person's opt-in and must say what it is for. Existing customers can be told about similar products if every message has an easy way to opt out.",
  },
  AE: {
    code: "AE", label: "United Arab Emirates", existingCustomerAllowed: true,
    plain: "Opt-in is the safe default. Emailing existing customers about similar products is allowed only where your own legal adviser has confirmed it.",
  },
  QA: {
    code: "QA", label: "Qatar", existingCustomerAllowed: true,
    plain: "Opt-in is the safe default. Emailing existing customers about similar products is allowed only where your own legal adviser has confirmed it.",
  },
  KW: {
    code: "KW", label: "Kuwait", existingCustomerAllowed: true,
    plain: "Opt-in is the safe default. Emailing existing customers about similar products is allowed only where your own legal adviser has confirmed it.",
  },
  OM: {
    code: "OM", label: "Oman", existingCustomerAllowed: true,
    plain: "Opt-in is the safe default. Emailing existing customers about similar products is allowed only where your own legal adviser has confirmed it.",
  },
  BH: {
    code: "BH", label: "Bahrain", existingCustomerAllowed: true,
    plain: "Opt-in is the safe default. Emailing existing customers about similar products is allowed only where your own legal adviser has confirmed it.",
  },
  IN: {
    code: "IN", label: "India", existingCustomerAllowed: false,
    plain: "Under India's data protection law a person must be told and agree, and an existing customer is not assumed to agree. Opt-in is always required.",
  },
  EU: {
    code: "EU", label: "European Union", existingCustomerAllowed: true,
    plain: "Opt-in is required, with no pre-ticked boxes. Existing customers can be emailed about similar goods if every message has an unsubscribe link.",
  },
  other: {
    code: "other", label: "Everywhere else", existingCustomerAllowed: true,
    plain: "We do not know this country's rule, so opt-in is the default. Relax it only on your legal adviser's say-so.",
  },
};

const EU_COUNTRIES = [
  "austria", "belgium", "bulgaria", "croatia", "cyprus", "czech republic", "czechia", "denmark", "estonia", "finland",
  "france", "germany", "greece", "hungary", "ireland", "italy", "latvia", "lithuania", "luxembourg", "malta",
  "netherlands", "poland", "portugal", "romania", "slovakia", "slovenia", "spain", "sweden",
  "at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu", "ie", "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es", "se",
];

const COUNTRY_TO_JURISDICTION: Record<string, JurisdictionCode> = {
  "saudi arabia": "SA", ksa: "SA", sa: "SA", "kingdom of saudi arabia": "SA",
  "united arab emirates": "AE", uae: "AE", ae: "AE", "u.a.e": "AE", "u.a.e.": "AE",
  qatar: "QA", qa: "QA",
  kuwait: "KW", kw: "KW",
  oman: "OM", om: "OM",
  bahrain: "BH", bh: "BH",
  india: "IN", in: "IN", bharat: "IN",
};
for (const c of EU_COUNTRIES) COUNTRY_TO_JURISDICTION[c] = "EU";

/** Jurisdiction of a free-text country (name or ISO-2). Unknown or empty is "other". */
export function jurisdictionForCountry(country: string | null | undefined): JurisdictionCode {
  const key = (country ?? "").trim().toLowerCase();
  return COUNTRY_TO_JURISDICTION[key] ?? "other";
}

export function isJurisdictionCode(v: unknown): v is JurisdictionCode {
  return typeof v === "string" && (JURISDICTIONS as readonly string[]).includes(v);
}

/**
 * The basis that actually applies: the tenant's choice, clamped by what the
 * jurisdiction recognises. A tenant that picked "existing_customer" for India
 * still gets consent_required, because the rule does not allow the other.
 */
export function effectiveBasis(
  jurisdiction: JurisdictionCode,
  tenantChoice: Partial<Record<JurisdictionCode, ConsentBasisSetting>> | null | undefined,
): ConsentBasisSetting {
  const choice = tenantChoice?.[jurisdiction] ?? "consent_required";
  if (choice === "existing_customer" && !JURISDICTION_RULES[jurisdiction].existingCustomerAllowed) return "consent_required";
  return choice === "existing_customer" ? "existing_customer" : "consent_required";
}
