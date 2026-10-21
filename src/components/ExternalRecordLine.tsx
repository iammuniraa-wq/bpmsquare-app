import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { EXTERNAL_RECORD_TIP } from "@/lib/connectors/externalRefTips";
import type { ExternalRef } from "@/lib/connectors/externalRef";

/**
 * One quiet fact line per linked system: "Dynamics 365 · QUO-01002 · Open in Dynamics ↗".
 * The label is always a readable number or name; the raw id is only the tooltip.
 * Renders nothing when the record has no link, so tenants without a connector
 * see no change. Presentational: pages load `refs` through ExternalRecordSlot.
 */
export default function ExternalRecordLine({ refs }: { refs: ExternalRef[] }) {
  if (!refs.length) return null;
  return (
    <div className="bpm-ext-lines" style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
      {refs.map((r) => (
        <div key={`${r.connectorId}:${r.title}`} className="bpm-ext-line" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 8px", fontSize: 12.5, color: c.muted }}>
          <span style={{ fontWeight: 600, color: c.ink }}>{r.system}</span>
          <span aria-hidden="true">·</span>
          <span title={r.title} style={{ wordBreak: "break-word" }}>{r.readable}</span>
          {r.deepLink && (
            <>
              <span aria-hidden="true">·</span>
              <a className="bpm-ext-open" href={r.deepLink} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, textDecoration: "none", fontWeight: 600 }}>
                {`Open in ${r.system.replace(/\s+\d+$/, "")} ↗`}
              </a>
            </>
          )}
          <InfoTip label={`${r.system} ${r.objectLabel.toLowerCase()}`}>{EXTERNAL_RECORD_TIP}</InfoTip>
        </div>
      ))}
    </div>
  );
}
