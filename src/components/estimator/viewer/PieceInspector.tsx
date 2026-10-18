"use client";

import { useMemo } from "react";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { getGeometry } from "@/lib/estimator/geometry";
import { buildCostAllocator, pieceSizeLabel, pieceWeightT } from "@/lib/estimator/pieceInfo";
import type { AllocLine } from "@/lib/estimator/pieceInfo";
import Button from "@/components/ui/Button";

const cell: React.CSSProperties = { padding: "5px 0", borderTop: "1px solid var(--line)", fontSize: 13, display: "flex", justifyContent: "space-between", gap: 12 };

/** The facts of the picked piece: mark, BOM line, size, volume, weight, cost share, erection step. */
export default function PieceInspector({
  model, mark, lines, densityTm3, money, onClear,
}: {
  model: GeometryModel;
  mark: string | null;
  lines: readonly AllocLine[];
  densityTm3: number;
  money: (n: number) => string;
  onClear: () => void;
}) {
  const alloc = useMemo(() => buildCostAllocator(model.pieces, lines), [model, lines]);
  const labels = useMemo(() => new Map((getGeometry(model.geometry)?.piece_codes ?? []).map((p) => [p.code, p.label])), [model]);
  const piece = mark ? model.pieces.find((p) => p.id === mark) ?? null : null;

  if (!piece) {
    return <div className="bpm-t-help" style={{ padding: "8px 0" }}>Click or tap a piece in the model, or type its mark, to see its size, weight and cost.</div>;
  }
  const cost = alloc(piece);
  const rows: [string, string][] = [
    ["Mark", piece.id],
    ["Piece", `${labels.get(piece.code) ?? piece.code}${piece.op ? (piece.op.door ? " (door opening)" : " (window opening)") : ""}`],
    ["Bill of materials line", cost.line ? cost.line.description : "Shared costs only"],
    ["Size (m)", pieceSizeLabel(piece)],
    ["Concrete", `${piece.vol.toFixed(3)} m³`],
    ["Weight", `${pieceWeightT(piece, densityTm3).toFixed(2)} t`],
    ["Cost share", `${money(cost.cost)} (${(cost.share * 100).toFixed(1)}% of the estimate)`],
    ["Erected in", model.step_names[piece.step] ?? `Step ${piece.step + 1}`],
  ];
  return (
    <div aria-live="polite">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span className="bpm-t-label">Selected piece</span>
        <Button size="sm" variant="quiet" onClick={onClear}>Clear</Button>
      </div>
      <dl style={{ margin: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={cell}>
            <dt style={{ color: "var(--muted)" }}>{k}</dt>
            <dd style={{ margin: 0, color: "var(--ink)", fontWeight: 600, textAlign: "right", overflowWrap: "anywhere" }}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="bpm-t-help" style={{ marginTop: 6 }}>
        Cost share is this piece&apos;s part of the estimate: its family&apos;s lines by volume (insulation by face area) and the shared costs (steel, moulds, labour, transport, erection, overhead) by volume.
      </div>
    </div>
  );
}
