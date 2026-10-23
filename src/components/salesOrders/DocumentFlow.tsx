import Link from "next/link";
import { FLOW_BOX, layoutFlow, type FlowLayout, type FlowModel, type FlowTone, type Orientation } from "./logic";
import { fmtMoney } from "./money";
import s from "./salesOrders.module.css";

const DOT: Record<FlowTone, string> = { done: s.dotDone, active: s.dotActive, bad: s.dotBad, planned: s.dotPlanned, neutral: s.dotNeutral };

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function Node({ n, currency }: { n: FlowLayout["nodes"][number]; currency: string }) {
  const { w, h } = FLOW_BOX;
  const amount = n.amount !== null ? fmtMoney(n.amount, currency) : "";
  const label = [n.title, n.ref, n.statusLabel, amount].filter(Boolean).join(", ");
  const box = (
    <>
      <rect className={s.nodeBox} x={n.x} y={n.y} width={w} height={h} rx={9} />
      <circle className={DOT[n.tone]} cx={n.x + w - 14} cy={n.y + 16} r={5} />
      <text className={s.nodeTitle} x={n.x + 12} y={n.y + 19}>{n.title}</text>
      <text className={s.nodeRef} x={n.x + 12} y={n.y + 38}>{clip(n.ref || (n.planned ? "Not yet" : "—"), 17)}</text>
      <text className={s.nodeSub} x={n.x + 12} y={n.y + 54}>{clip([n.statusLabel, amount].filter(Boolean).join(" · "), 26)}</text>
    </>
  );
  const cls = `${s.node} ${n.planned ? s.nodePlanned : ""} ${n.current ? s.nodeCurrent : ""}`;
  if (n.href && !n.current) {
    return (
      <g className={cls} data-node={n.id} data-kind={n.kind}>
        <Link href={n.href} className={s.nodeLink} aria-label={`Open ${label}`}>{box}</Link>
      </g>
    );
  }
  return (
    <g className={cls} data-node={n.id} data-kind={n.kind} role="img" aria-label={n.current ? `This order: ${label}` : n.planned ? `Planned ${n.title.toLowerCase()}` : label}>
      {box}
    </g>
  );
}

function Svg({ layout, currency }: { layout: FlowLayout; currency: string }) {
  return (
    <svg
      className={s.flowSvg}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="group"
      aria-label={`Document flow, ${layout.orientation === "across" ? "left to right" : "top to bottom"}`}
    >
      <g className={s.link}>
        {layout.links.map((l) => (
          <path key={`${l.from}-${l.to}`} d={l.d} className={`${s.linkPath} ${l.planned ? s.linkPlanned : ""}`} data-link={`${l.from}>${l.to}`} />
        ))}
      </g>
      {layout.nodes.map((n) => <Node key={n.id} n={n} currency={currency} />)}
    </svg>
  );
}

/**
 * The swimlane: email or quote, then the order, then each delivery followed by its invoice. Boxes carry a status dot and
 * an amount, dashed boxes are still to come, every other box opens its record. Left to right on a desktop; top to
 * bottom under 900 px (both are drawn and CSS shows one), so a phone never needs a sideways page scroll.
 */
export default function DocumentFlow({ model, currency }: { model: FlowModel; currency: string }) {
  const orientations: Orientation[] = ["across", "down"];
  return (
    <div className={s.flowWrap} data-guide="sales_order.flow">
      {orientations.map((o) => (
        <div key={o} className={o === "across" ? s.flowAcross : s.flowDown} data-orientation={o}>
          <Svg layout={layoutFlow(model, o)} currency={currency} />
        </div>
      ))}
    </div>
  );
}
