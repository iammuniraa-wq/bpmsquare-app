"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Card from "@/components/ui/Card";
import type { FenceView } from "@/lib/estimator/fenceView";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { densityFromRates } from "@/lib/estimator/geometry";
import type { TemplateRate } from "@/lib/estimator/types";
import type { WorkspaceLine } from "./types";

// three.js is only fetched when the 3D view is opened. The 3D view is the shared piece viewer, so the fence is
// drawn from the same pieces the price is added up from, with the design colours painted on.
const BuildingViewer = dynamic(() => import("@/components/estimator/BuildingViewer"), {
  ssr: false,
  loading: () => <div className="bpm-t-help" style={{ padding: 16 }}>Loading the 3D view…</div>,
});

const POST_LABEL: Record<string, string> = { LP: "line posts", SP: "straining posts", CP: "corner posts", TP: "end posts", GP: "gate posts" };
const POST_FILL: Record<string, string> = { LP: "var(--muted)", SP: "var(--ink)", CP: "var(--accent)", TP: "var(--accent)", GP: "var(--amberink)" };

/**
 * The fence, drawn from the same model the price is added up from: a plan (every post
 * where it stands, gates marked) and the Fence configurator's own 3D view. Replaces the
 * villa card for a fence template.
 */
export default function FenceCard({
  view, model, lines, rates, money, highlightMarks, visuals,
}: {
  view: FenceView;
  model: GeometryModel | null;
  lines: readonly WorkspaceLine[];
  rates: readonly TemplateRate[];
  money: (n: number) => string;
  highlightMarks?: readonly string[];
  /** Design slot -> material key or "#rrggbb" (resolveVisuals). */
  visuals?: Readonly<Record<string, string>>;
}) {
  const [mode, setMode] = useState<"plan" | "3d">("plan");
  const { posts, gatePoints, w, d, layout } = view;

  const plan = useMemo(() => {
    const W = 700; const H = 360; const pad = 44;
    const sx = (W - pad * 2) / Math.max(w, 1);
    const sy = layout === "closed_perimeter" ? (H - pad * 2) / Math.max(d, 1) : Infinity;
    const k = Math.min(sx, sy);
    const px = (x: number) => W / 2 + x * k;
    const pz = (z: number) => H / 2 + z * k;
    return { W, H, k, px, pz };
  }, [w, d, layout]);

  return (
    <div id="villa" style={{ scrollMarginTop: 80, minWidth: 0 }}>
      <Card title="The fence" padding={16}
        action={(
          <div role="group" aria-label="Preview" style={{ display: "flex", gap: 6 }}>
            {(["plan", "3d"] as const).map((m) => (
              <button key={m} type="button" className="est-opt" aria-pressed={mode === m} onClick={() => setMode(m)} style={{ padding: "5px 12px", minHeight: 32 }}>
                {m === "plan" ? "Plan" : "3D"}
              </button>
            ))}
          </div>
        )}>
        {mode === "plan" ? (
          <svg viewBox={`0 0 ${plan.W} ${plan.H}`} role="img" style={{ width: "100%", height: "auto", maxHeight: 380, display: "block" }}
            aria-label={`Plan of the fence: ${view.totalLength} metres, ${view.geometry.total_posts} posts, ${view.gates.length} gates`}>
            {layout === "closed_perimeter" ? (
              <rect x={plan.px(-w / 2)} y={plan.pz(-d / 2)} width={w * plan.k} height={d * plan.k} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
            ) : (
              <line x1={plan.px(-w / 2)} y1={plan.pz(0)} x2={plan.px(w / 2)} y2={plan.pz(0)} stroke="var(--accent)" strokeWidth={2.5} />
            )}
            {posts.map((p, i) => (
              <circle key={i} cx={plan.px(p.x)} cy={plan.pz(p.z)} r={p.code === "LP" ? 2.6 : 4.6} fill={POST_FILL[p.code] ?? "var(--muted)"} />
            ))}
            {gatePoints.map((g, i) => (
              <rect key={i} x={plan.px(g.x) - 9} y={plan.pz(g.z) - 9} width={18} height={18} rx={3} fill="var(--amberbg)" stroke="var(--amberink)" strokeWidth={2} />
            ))}
            <text x={plan.W / 2} y={plan.H - 10} textAnchor="middle" fontSize={13} fill="var(--muted)">
              {view.totalLength} m {layout === "closed_perimeter" ? "all the way round" : "straight run"}
            </text>
          </svg>
        ) : (
          <div style={{ height: 380, position: "relative" }}>
            <BuildingViewer model={model} lines={lines} densityTm3={densityFromRates([...rates])} money={money} highlightMarks={highlightMarks} visuals={visuals} />
          </div>
        )}
        <div className="est-chips" style={{ marginTop: 10 }}>
          {(["LP", "SP", "CP", "TP", "GP"] as const).map((code) => {
            const n = posts.filter((p) => p.code === code).length;
            return n > 0 ? <span key={code} className="bpm-t-help"><b style={{ color: "var(--ink)" }}>{n}</b> {POST_LABEL[code]}</span> : null;
          })}
          <span className="bpm-t-help"><b style={{ color: "var(--ink)" }}>{Math.round(view.geometry.fabric_area_m2).toLocaleString("en-GB")}</b> m² of fabric</span>
          {view.gates.length > 0 && <span className="bpm-t-help"><b style={{ color: "var(--ink)" }}>{view.gates.length}</b> gate{view.gates.length === 1 ? "" : "s"}</span>}
        </div>
      </Card>
    </div>
  );
}
