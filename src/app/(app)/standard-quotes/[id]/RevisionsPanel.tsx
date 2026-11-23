import Link from "next/link";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { c } from "@/lib/theme";
import { describeDiff } from "@/lib/revisions/snapshot";
import type { RevisionRow } from "@/lib/revisions/server";
import { REVISION_TIPS } from "@/lib/revisions/tips";

const fmt = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const label = (n: number) => `Rev. ${String(n).padStart(2, "0")}`;

/** The revision history of a quotation: revision, date, person, reason, total, what changed since the one before, and its PDF. */
export default function RevisionsPanel({ quoteId, rows, money, workingRevision, inPreparation }: {
  quoteId: string;
  rows: RevisionRow[];
  money: (n: number) => string;
  workingRevision: number;
  inPreparation: boolean;
}) {
  return (
    <Card padding={16}>
      <div className="bpm-label-row" style={{ marginBottom: 8 }}>
        <span className="bpm-t-label">Revisions</span>
        <InfoTip label="Revisions">{REVISION_TIPS.tab}</InfoTip>
      </div>
      {inPreparation && <div style={{ fontSize: 13, color: c.amberink, fontWeight: 600, marginBottom: 8 }}>{label(workingRevision)} in preparation</div>}
      {rows.length === 0 ? (
        <div className="bpm-t-help">Nothing has been issued yet. Issue the quotation to keep it as Rev. 00.</div>
      ) : (
        <div style={{ overflowX: "auto" }} data-guide="sq-revisions-table">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: c.hint }}>
                {["Revision", "Issued", "By", "Reason", "Total", "Change", ""].map((h) => <th key={h} style={{ padding: "6px 8px", fontWeight: 500, fontSize: 11.5, whiteSpace: "nowrap" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.revision_no} style={{ borderTop: `1px solid ${c.line}` }}>
                  <td style={{ padding: "8px", fontWeight: 600, whiteSpace: "nowrap" }}>{label(r.revision_no)}</td>
                  <td style={{ padding: "8px", whiteSpace: "nowrap" }}>{fmt(r.issued_at)}</td>
                  <td style={{ padding: "8px" }}>{r.issued_by_name ?? "—"}</td>
                  <td style={{ padding: "8px", minWidth: 160, whiteSpace: "pre-line" }}>{r.reason ?? "—"}</td>
                  <td style={{ padding: "8px", whiteSpace: "nowrap" }}>{money(r.total)}</td>
                  <td style={{ padding: "8px", color: c.muted }}>{r.revision_no === 0 ? "First issue" : describeDiff(r.diff, money)}</td>
                  <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                    <Link href={`/api/standard-quotes/${quoteId}/pdf?rev=${r.revision_no}`} style={{ color: c.accent, textDecoration: "none", minHeight: 44, display: "inline-flex", alignItems: "center" }} data-guide="sq-open-revision-pdf">PDF</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
