"use client";

import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import type { TenantEntity } from "@/lib/constants";
import { COMPANY_TIPS } from "./tips";
import s from "./company.module.css";

/**
 * The seller details ZATCA needs, on one legal entity (one entity = one seller unit with its own invoice counter). Shown in the
 * entity panel only for a workspace with Saudi e-invoicing. The VAT number falls back to the generic Tax ID when left empty.
 */
export default function EinvoiceSellerFields({ entity, onPatch }: { entity: TenantEntity; onPatch: (p: Partial<TenantEntity>) => void }) {
  const text = (key: keyof TenantEntity) => ({
    value: (entity[key] as string | undefined) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onPatch({ [key]: e.target.value } as Partial<TenantEntity>),
  });
  return (
    <details className={s.more} open={!(entity.vat_number || entity.gstin)} data-guide="company.entity.einvoice">
      <summary>Saudi e-invoicing</summary>
      <div className={s.moreBody}>
        <span className="bpm-label-row"><span className="bpm-t-label">Seller details for ZATCA</span><InfoTip label="Seller details for ZATCA">{COMPANY_TIPS.einvoiceSeller}</InfoTip></span>
        <Field label="VAT number" info={COMPANY_TIPS.vatNumber}><Input id="seller-vat_number" className={s.mono} inputMode="numeric" placeholder="300000000000003" {...text("vat_number")} /></Field>
        <Field label="Commercial registration (CRN)"><Input id="seller-crn" className={s.mono} inputMode="numeric" placeholder="1010000000" {...text("crn")} /></Field>
        <Field label="Legal name in Arabic"><Input id="seller-name_ar" dir="rtl" lang="ar" {...text("name_ar")} /></Field>
        <Field label="Building number"><Input id="seller-building_number" className={s.mono} inputMode="numeric" placeholder="1234" {...text("building_number")} /></Field>
        <Field label="Street"><Input id="seller-street" {...text("street")} /></Field>
        <Field label="District"><Input id="seller-district" {...text("district")} /></Field>
        <Field label="City"><Input id="seller-city" {...text("city")} /></Field>
        <Field label="Postal code"><Input id="seller-postal_code" className={s.mono} inputMode="numeric" placeholder="12345" {...text("postal_code")} /></Field>
        <Field label="Country"><Input id="seller-country" placeholder="SA" {...text("country")} /></Field>
      </div>
    </details>
  );
}
