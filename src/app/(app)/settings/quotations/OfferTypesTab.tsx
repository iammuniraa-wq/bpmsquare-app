"use client";

import InfoTip from "@/components/ui/InfoTip";
import { Toggle } from "@/components/settings/generalShared";
import { QUOTE_TYPES, type QuoteTypeId } from "@/lib/constants";
import type { TypeVisibility } from "./quotationsLogic";
import { QUOTATION_TIPS } from "./tips";
import s from "./quotations.module.css";

/** Offer types: the shared toggle list, one row each. A hidden type leaves the New Quotation picker. */
export default function OfferTypesTab({ visibility, accent, onChange }: { visibility: TypeVisibility; accent: string; onChange: (next: TypeVisibility) => void }) {
  return (
    <div className={s.shell}>
      <div className={s.bar}>
        <span className={`bpm-label-row ${s.barLabel}`}><span className="bpm-t-label">Offer types</span><InfoTip label="Offer types">{QUOTATION_TIPS.offerTypes}</InfoTip></span>
      </div>
      <div className={s.listCard}>
        {QUOTE_TYPES.map((t) => {
          const id = t.id as QuoteTypeId;
          return (
            <div key={t.id} className={s.toggleRow} data-off={!visibility[id]}>
              <span className={s.toggleName}>
                {t.label}
                <InfoTip label={t.label}>{t.description}</InfoTip>
                {!t.available && <span className={`${s.pill} ${s.pillMuted}`}>Coming soon</span>}
              </span>
              <Toggle on={visibility[id]} onChange={(v) => onChange({ ...visibility, [id]: v })} accent={accent} label={`Show ${t.label}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
