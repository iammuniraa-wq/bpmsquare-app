import type { TenantEntity } from "@/lib/constants";
import {
  ZATCA_RULES, isBuyerType, isEinvoiceDocType,
  type EinvoiceBuyer, type EinvoiceDocType, type EinvoiceSeller, type StructuredAddress,
} from "./rules";

// Turns the records the app already has (an entity from Settings > Company, an account) into the seller and buyer
// shapes the readiness check reads. Pure: no database, no decryption (the caller passes an already decrypted account).

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/** Removes the spaces and dashes people type into a registration number, so "300 0000 0000 0003" is accepted. */
export function normaliseTaxId(v: unknown): string | null {
  const t = clean(v);
  return t == null ? null : t.replace(/[\s-]/g, "");
}

/** "Saudi Arabia", "KSA", "sa" -> "SA". Anything else is passed through trimmed (the validator will say it is not SA). */
export function countryCode(v: unknown): string | null {
  const t = clean(v);
  if (t == null) return null;
  const k = t.toLowerCase().replace(/[.\s]/g, "");
  if (["sa", "ksa", "saudiarabia", "kingdomofsaudiarabia", "السعودية", "المملكةالعربيةالسعودية"].includes(k)) return ZATCA_RULES.country;
  return t.length === 2 ? t.toUpperCase() : t;
}

/** The seller unit of an invoice: the entity it names, else the default entity, else the first. */
export function pickEntity(entities: TenantEntity[] | undefined, entityId: string | null | undefined): TenantEntity | null {
  const list = entities ?? [];
  if (list.length === 0) return null;
  return list.find((e) => e.id === entityId) ?? list.find((e) => e.is_default) ?? list[0];
}

export function sellerFromEntity(entity: TenantEntity | null): EinvoiceSeller {
  if (!entity) {
    return { key: "", name: null, name_ar: null, vat_number: null, crn: null, address: emptyAddress() };
  }
  return {
    key: entity.id,
    name: clean(entity.name),
    name_ar: clean(entity.name_ar),
    // The generic "Tax ID" is the fallback so a workspace that already typed its VAT number there is not asked twice.
    vat_number: normaliseTaxId(entity.vat_number) ?? normaliseTaxId(entity.gstin),
    crn: normaliseTaxId(entity.crn),
    address: {
      building_number: clean(entity.building_number),
      street: clean(entity.street),
      district: clean(entity.district),
      city: clean(entity.city),
      postal_code: clean(entity.postal_code),
      country: countryCode(entity.country),
    },
  };
}

function emptyAddress(): StructuredAddress {
  return { building_number: null, street: null, district: null, city: null, postal_code: null, country: null };
}

/** The columns of an account the buyer needs. `gstin` is the generic tax id (decrypted), the fallback for the VAT number. */
export type AccountForBuyer = {
  name?: string | null;
  name_ar?: string | null;
  vat_number?: string | null;
  gstin?: string | null;
  crn?: string | null;
  buyer_type?: string | null;
  address_building?: string | null;
  address_line1?: string | null;
  address_district?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
  buyer_id_number?: string | null;
  buyer_id_scheme?: string | null;
};

export function buyerFromAccount(account: AccountForBuyer | null): EinvoiceBuyer {
  if (!account) {
    return { name: null, name_ar: null, buyer_type: "business", vat_number: null, crn: null, address: emptyAddress(), id_number: null, id_scheme: null };
  }
  return {
    name: clean(account.name),
    name_ar: clean(account.name_ar),
    buyer_type: isBuyerType(account.buyer_type) ? account.buyer_type : "business",
    vat_number: normaliseTaxId(account.vat_number) ?? normaliseTaxId(account.gstin),
    crn: normaliseTaxId(account.crn),
    address: {
      building_number: clean(account.address_building),
      street: clean(account.address_line1),
      district: clean(account.address_district),
      city: clean(account.city),
      postal_code: clean(account.postal_code),
      country: countryCode(account.country),
    },
    id_number: clean(account.buyer_id_number),
    id_scheme: clean(account.buyer_id_scheme),
  };
}

/**
 * The document type of a new invoice: a buyer that is a business with a VAT number gets a Standard tax invoice
 * (cleared by ZATCA before it is valid), anyone else a Simplified one (reported within 24 hours). A workspace may
 * choose the type a buyer WITHOUT a VAT number gets (`config.einvoicing.default_doc_type`, default simplified).
 * An explicit credit or debit note is never overridden; an explicit standard/simplified choice stands.
 */
export function resolveDocType(opts: {
  explicit?: EinvoiceDocType | string | null;
  buyer: Pick<EinvoiceBuyer, "buyer_type" | "vat_number">;
  defaultDocType?: "standard" | "simplified" | null;
}): EinvoiceDocType {
  if (isEinvoiceDocType(opts.explicit)) return opts.explicit;
  if (opts.buyer.buyer_type === "individual") return "simplified";
  if (opts.buyer.vat_number) return "standard";
  return opts.defaultDocType === "standard" ? "standard" : "simplified";
}

export const isNote = (t: EinvoiceDocType | null | undefined) => t === "credit_note" || t === "debit_note";
