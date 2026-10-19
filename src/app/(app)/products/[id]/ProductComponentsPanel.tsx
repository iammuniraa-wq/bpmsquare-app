import { c } from "@/lib/theme";
import { CARD_SURFACE } from "@/components/ui/Card";
import type { BomRowView } from "@/lib/products/bomView";
import BomCostSummary, { type BomSummaryData } from "./BomCostSummary";
import BomLinesTable from "./BomLinesTable";
import BomAddComponent from "./BomAddComponent";

/** The Components tab of a BOM / kit: cost roll-up, the component lines, and
 *  the add control. Server component; the three parts are client components
 *  that call the BOM API and refresh the page. */
export default function ProductComponentsPanel({ productId, kitLabel, rows, summary, storedCost, storedAsOf, canEdit }: {
  productId: string;
  kitLabel: string;
  rows: BomRowView[];
  summary: BomSummaryData;
  storedCost: number | null;
  storedAsOf: string | null;
  canEdit: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <div className="bpm-t-help">
        Only {kitLabel} items can have components. A component can be any item, including another kit.
        Consumed components add to the material cost; a tool that is only used does not.
      </div>
      <BomCostSummary productId={productId} data={summary} storedCost={storedCost} storedAsOf={storedAsOf} canEdit={canEdit} />
      <section style={{ ...CARD_SURFACE, padding: 0, overflow: "hidden", minWidth: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: rows.length ? `1px solid ${c.line}` : undefined }}>
          <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: c.ink }}>Components ({rows.length})</h2>
        </div>
        <BomLinesTable productId={productId} rows={rows} canEdit={canEdit} />
        {canEdit && <BomAddComponent productId={productId} />}
      </section>
    </div>
  );
}
