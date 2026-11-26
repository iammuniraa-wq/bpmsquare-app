import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import StatusPill from "@/components/ui/StatusPill";
import { lineState, type LineState } from "@/lib/site/receiptRules";
import { CONDITION_LABEL, reasonLabel, type SiteReceiptLine } from "@/lib/site/types";

const TONE: Record<LineState, "green" | "amber" | "red"> = { ok: "green", short: "amber", over: "amber", rejected: "red", damaged: "amber" };
const LABEL: Record<LineState, string> = { ok: "OK", short: "Short", over: "More than expected", rejected: "Rejected", damaged: "Damaged" };

/**
 * The visual summary of a receipt: for each item a bar of what was expected against what was accepted and rejected, so the shortfall is read in a
 * second. The number is "Received on site", never progress or installation.
 */
export default function ReceiptLineBars({ lines }: { lines: SiteReceiptLine[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-guide="site.receipt.lines">
      {lines.map((l) => {
        const st = lineState(l);
        const scale = Math.max(l.qty_expected ?? 0, l.qty_received, 1);
        const acc = (l.qty_accepted / scale) * 100;
        const rej = (l.qty_rejected / scale) * 100;
        const exp = l.qty_expected !== null ? Math.min(100, (l.qty_expected / scale) * 100) : null;
        return (
          <section key={l.id} style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: c.ink, fontSize: 14, overflowWrap: "anywhere" }}>{l.element_code ? `${l.element_code} · ` : ""}{l.description}</div>
                <div style={{ fontSize: 12, color: c.hint }}>{l.building ? `Building ${l.building} · ` : ""}{CONDITION_LABEL[l.condition]}{l.reason_code ? ` · ${reasonLabel(l.reason_code)}` : ""}</div>
              </div>
              <StatusPill label={LABEL[st]} tone={TONE[st]} />
            </div>
            <div style={{ position: "relative", height: 12, borderRadius: 6, background: c.panel2, overflow: "hidden", display: "flex" }} role="img"
              aria-label={`Accepted ${l.qty_accepted}, rejected ${l.qty_rejected}${l.qty_expected !== null ? `, expected ${l.qty_expected}` : ""}`}>
              <div style={{ width: `${acc}%`, background: "var(--greenink)" }} />
              <div style={{ width: `${rej}%`, background: "var(--redink)" }} />
              {exp !== null && <div style={{ position: "absolute", top: 0, bottom: 0, left: `${exp}%`, width: 2, background: c.ink }} title={`Expected ${l.qty_expected}`} />}
            </div>
            <div style={{ display: "flex", gap: "2px 16px", flexWrap: "wrap", fontSize: 12.5, color: c.muted, fontVariantNumeric: "tabular-nums" }}>
              {l.qty_expected !== null && <span>Expected {l.qty_expected}{l.uom ? ` ${l.uom}` : ""}</span>}
              <span>Received {l.qty_received}</span>
              <span style={{ color: "var(--greenink)" }}>Accepted {l.qty_accepted}</span>
              {l.qty_rejected > 0 && <span style={{ color: "var(--redink)" }}>Rejected {l.qty_rejected}</span>}
            </div>
            {l.note && <div style={{ fontSize: 12.5, color: c.muted }}>{l.note}</div>}
          </section>
        );
      })}
    </div>
  );
}
