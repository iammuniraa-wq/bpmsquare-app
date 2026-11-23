"use client";

import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { Toggle } from "@/components/settings/generalShared";
import { DEFAULT_QUOTE_ID_FORMAT, type QuoteIdFormat, type TenantFeatures } from "@/lib/constants";
import { formatQuoteRef } from "@/lib/quoteRefFormat";
import { visibleRanges } from "./companyLogic";
import { COMPANY_TIPS } from "./tips";
import s from "./company.module.css";

/**
 * The quote ID format (the only one a workspace can change) and, collapsed, the IDs the system makes itself.
 * A new format applies to new quotations; existing IDs are never rewritten.
 */
export default function NumberingTab({ features, format, onFormat, sqFormat = null, onSqFormat = () => {}, keepRevisions = false, onKeepRevisions = () => {}, accent = "" }: {
  features: Partial<TenantFeatures> | undefined;
  format: QuoteIdFormat;
  onFormat: (patch: Partial<QuoteIdFormat>) => void;
  /** The Standard Quote series: null = the fixed SQ-YYYY-NNNN. */
  sqFormat?: QuoteIdFormat | null;
  onSqFormat?: (next: QuoteIdFormat | null) => void;
  keepRevisions?: boolean;
  onKeepRevisions?: (on: boolean) => void;
  accent?: string;
}) {
  const ranges = visibleRanges(features);
  return (
    <div className={s.shell}>
      {features?.quotations === true && (
        <div className={s.card}>
          <div className={s.grid}>
            <Field label="Prefix"><Input value={format.prefix} onChange={(e) => onFormat({ prefix: e.target.value })} placeholder="QT" /></Field>
            <Field label="Template" info={COMPANY_TIPS.quoteTemplate}>
              <Input className={s.mono} value={format.template} onChange={(e) => onFormat({ template: e.target.value })} placeholder="{PREFIX}-{YYYY}-{SEQ}" />
            </Field>
            <Field label="Digits" info={COMPANY_TIPS.quoteDigits}>
              <Input type="number" min={2} max={6} value={format.seq_digits} onChange={(e) => onFormat({ seq_digits: Math.min(6, Math.max(2, parseInt(e.target.value) || 4)) })} />
            </Field>
            <Field label="Restart numbering" info={COMPANY_TIPS.quoteReset}>
              <Select value={format.reset} onChange={(e) => onFormat({ reset: e.target.value as QuoteIdFormat["reset"] })}>
                <option value="yearly">Every year</option>
                <option value="never">Never</option>
              </Select>
            </Field>
            <div className={s.full}><span className="bpm-t-help">Next quotation: </span><span className={s.example}>{formatQuoteRef(format, new Date(), 1)}</span></div>
          </div>
        </div>
      )}
      {features?.standard_quotes === true && (
        <div className={s.card} data-guide="company.numbering.standard-quotes">
          <div className="bpm-label-row" style={{ marginBottom: 6 }}><span className="bpm-t-label">Standard Quotes</span><InfoTip label="Standard Quotes">{COMPANY_TIPS.sqSeries}</InfoTip></div>
          <div className={s.switchRow}>
            <span className="bpm-label-row"><span className="bpm-t-label">Own number pattern</span><InfoTip label="Own number pattern">{COMPANY_TIPS.sqPattern}</InfoTip></span>
            <Toggle on={sqFormat !== null} onChange={(on) => onSqFormat(on ? { ...DEFAULT_QUOTE_ID_FORMAT, prefix: "SQ" } : null)} accent={accent} label="Own number pattern" />
          </div>
          {sqFormat && (
            <div className={s.grid}>
              <Field label="Prefix"><Input value={sqFormat.prefix} onChange={(e) => onSqFormat({ ...sqFormat, prefix: e.target.value })} placeholder="SQ" /></Field>
              <Field label="Template" info={COMPANY_TIPS.quoteTemplate}>
                <Input className={s.mono} value={sqFormat.template} onChange={(e) => onSqFormat({ ...sqFormat, template: e.target.value })} placeholder="{SEQ} / {YYYY}" />
              </Field>
              <Field label="Digits" info={COMPANY_TIPS.quoteDigits}>
                <Input type="number" min={2} max={6} value={sqFormat.seq_digits} onChange={(e) => onSqFormat({ ...sqFormat, seq_digits: Math.min(6, Math.max(2, parseInt(e.target.value) || 4)) })} />
              </Field>
              <Field label="Restart numbering" info={COMPANY_TIPS.quoteReset}>
                <Select value={sqFormat.reset} onChange={(e) => onSqFormat({ ...sqFormat, reset: e.target.value as QuoteIdFormat["reset"] })}>
                  <option value="yearly">Every year</option>
                  <option value="never">Never</option>
                </Select>
              </Field>
              <div className={s.full}><span className="bpm-t-help">Next Standard Quote: </span><span className={s.example}>{formatQuoteRef(sqFormat, new Date(), 1)}</span></div>
            </div>
          )}
          <div className={s.switchRow}>
            <span className="bpm-label-row"><span className="bpm-t-label">Keep revisions and lock issued quotes</span><InfoTip label="Keep revisions">{COMPANY_TIPS.keepRevisions}</InfoTip></span>
            <Toggle on={keepRevisions} onChange={onKeepRevisions} accent={accent} label="Keep revisions and lock issued quotes" />
          </div>
        </div>
      )}
      {ranges.length > 0 && (
        <details className={s.card}>
          <summary className="bpm-t-label" style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>System IDs ({ranges.length})</summary>
          <table className={s.ranges}>
            <thead><tr><th>Object</th><th>Format</th><th>Restarts</th></tr></thead>
            <tbody>
              {ranges.map((r) => (
                <tr key={r.object}><td>{r.object}</td><td className={s.mono}>{r.example}</td><td>{r.reset}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
