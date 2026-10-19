import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import RelatedList from "@/components/page/RelatedList";
import ItemTypeBadge from "@/components/products/ItemTypeBadge";

export type UsedInRow = {
  lineId: string;
  qty: number;
  uom: string | null;
  lineKind: "consumed" | "used";
  parent: { id: string; ref: string | null; name: string; sku: string | null; item_type: string | null };
  parentTypeLabel: string | null;
};

/** "Used in": the BOM kits that contain this product, for any product of any type. */
export default function ProductUsedInCard({ rows }: { rows: UsedInRow[] }) {
  return (
    <RelatedList
      title="Used in"
      rows={rows}
      rowKey={(r) => r.lineId}
      rowHref={(r) => ROUTES.product(r.parent.id)}
      emptyText="Not used in any BOM yet."
      columns={[
        {
          label: "BOM / kit",
          render: (r) => (
            <>
              <Link href={ROUTES.product(r.parent.id)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none" }}>{r.parent.name}</Link>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                {r.parent.sku && <span style={{ fontFamily: "monospace", fontSize: 11.5, color: c.hint }}>{r.parent.sku}</span>}
                <ItemTypeBadge typeKey={r.parent.item_type} label={r.parentTypeLabel} />
              </div>
            </>
          ),
        },
        { label: "Qty", align: "right", render: (r) => `${r.qty}${r.uom ? ` ${r.uom}` : ""}` },
        { label: "Kind", render: (r) => (r.lineKind === "used" ? "Used (tool)" : "Consumed") },
      ]}
    />
  );
}
