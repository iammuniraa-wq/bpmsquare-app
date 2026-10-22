"use client";

import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { Toggle } from "@/components/settings/generalShared";
import type { TenantTaxConfig } from "@/lib/constants";
import { CURRENCIES, CURRENCY_CODES, formatMoney, type CurrencyCode } from "@/lib/currency";
import { COMPANY_TIPS } from "./tips";
import s from "./company.module.css";

/** Workspace currency (every workspace) and, where documents are printed, the tax line. Four controls. */
export default function TaxTab({ currency, tax, showTax, accent, onCurrency, onTax }: {
  currency: CurrencyCode;
  tax: TenantTaxConfig;
  showTax: boolean;
  accent: string;
  onCurrency: (code: CurrencyCode) => void;
  onTax: (patch: Partial<TenantTaxConfig>) => void;
}) {
  const def = CURRENCIES[currency];
  return (
    <div className={s.card}>
      <div className={s.grid}>
        <Field label="Currency" info={COMPANY_TIPS.currency} hint={`e.g. ${formatMoney(1250000, def)}`}>
          <Select value={currency} onChange={(e) => onCurrency(e.target.value as CurrencyCode)}>
            {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code} — {CURRENCIES[code].name}</option>)}
          </Select>
        </Field>
        {showTax && (
          <>
            <span aria-hidden="true" />
            <Field label="Tax label" info={COMPANY_TIPS.taxLabel}>
              <Input value={tax.label} onChange={(e) => onTax({ label: e.target.value })} placeholder="GST / VAT / MwSt" />
            </Field>
            <Field label="Rate (%)">
              <Input type="number" min={0} max={100} value={tax.rate} onChange={(e) => onTax({ rate: parseFloat(e.target.value) || 0 })} />
            </Field>
            <div className={`${s.switchRow} ${s.full}`}>
              <span className="bpm-label-row"><span className="bpm-t-label">Rates include tax</span><InfoTip label="Rates include tax">{COMPANY_TIPS.inclusive}</InfoTip></span>
              <Toggle on={tax.inclusive} onChange={(v) => onTax({ inclusive: v })} accent={accent} label="Rates include tax" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
