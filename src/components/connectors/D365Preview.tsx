"use client";

import { useMemo, useState } from "react";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { previewColumns, cellText } from "@/lib/connectors/d365/preview";
import { D365_TIPS } from "@/lib/connectors/d365/tips";

type Row = Record<string, unknown>;

const MONO = "ui-monospace, Menlo, monospace";
const th: React.CSSProperties = { textAlign: "left", padding: "7px 12px", background: c.panel2, color: c.hint, fontWeight: 600, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "7px 12px", color: c.ink, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/**
 * Sample rows from the external system. The fields the map fills come first,
 * titled with the BPMSquare field they fill; every other column that carries
 * data sits behind "Show all fields". Plain props only, so any screen can
 * mount it.
 */
export default function D365Preview({ title, rows, fieldMap, onClose }: {
  title: string;
  rows: Row[];
  /** BPMSquare field -> external column, as saved for the entity. */
  fieldMap: Record<string, string>;
  onClose?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const cols = useMemo(() => previewColumns(rows, fieldMap), [rows, fieldMap]);

  return (
    <Card
      padding={0}
      style={{ overflow: "hidden" }}
    >
      <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", borderBottom: `1px solid ${c.line}` }}>
        <span className="bpm-label-row" style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>
          Preview · {title}
          <InfoTip label="Preview">{D365_TIPS.preview}</InfoTip>
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          {rows.length > 0 && (
            <Button size="sm" aria-pressed={showAll} onClick={() => setShowAll((s) => !s)}>{showAll ? "Hide extra fields" : "Show all fields"}</Button>
          )}
          {onClose && <Button size="sm" variant="quiet" onClick={onClose}>Close</Button>}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 14, fontSize: 12.5, color: c.hint }}>No rows came back. Check the entity and the filter, then preview again.</div>
      ) : (
        <>
          {cols.mapped.length > 0 && (
            <>
              <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      {cols.mapped.map((m) => (
                        <th key={m.target} style={th} title={`Read from ${m.source}`}>
                          {m.target}
                          {!m.found && <span style={{ color: "var(--amberink)", marginLeft: 6 }} title={`${m.source} is not in these rows`}>not found</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${c.line}` }}>
                        {cols.mapped.map((m) => <td key={m.target} style={td} title={cellText(r[m.source]) || undefined}>{cellText(r[m.source]) || "—"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bpm-rows-cards" style={{ gap: 8, padding: 10 }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {cols.mapped.map((m) => (
                      <div key={m.target} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                        <span style={{ color: c.hint, flexShrink: 0 }}>{m.target}</span>
                        <span style={{ color: c.ink, textAlign: "right", wordBreak: "break-word", minWidth: 0 }}>{cellText(r[m.source]) || "—"}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}

          {showAll && (
            <div style={{ borderTop: cols.mapped.length ? `1px solid ${c.line}` : undefined }}>
              {cols.raw.length === 0 ? (
                <div style={{ padding: 14, fontSize: 12.5, color: c.hint }}>No other fields carry data in these rows.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 11.5 }}>
                    <thead><tr>{cols.raw.map((k) => <th key={k} style={{ ...th, fontFamily: MONO }}>{k}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${c.line}` }}>
                          {cols.raw.map((k) => <td key={k} style={td} title={cellText(r[k]) || undefined}>{cellText(r[k])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {cols.hidden > 0 && <div style={{ padding: "6px 14px 10px", fontSize: 11.5, color: c.hint }}>{cols.hidden} empty or system column{cols.hidden === 1 ? "" : "s"} left out.</div>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
