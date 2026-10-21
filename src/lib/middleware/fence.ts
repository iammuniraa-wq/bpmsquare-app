import type { FenceSelection } from "./types";

// Shapes what leaves for the ERP when the Standard Quote came from a fence
// project (docs/design/integration-middleware.md, "what goes out for fence
// projects"). Pure. A quote that did not come from a fence project is passed
// through untouched: the selection does not apply to it.

export type FenceInfo = {
  name: string;
  layout: "open_run" | "closed_perimeter" | string;
  total_length_m: number;
  fabric_height_m: number | null;
  mesh_spec: string | null;
  coating: string | null;
  security_profile: string | null;
  gates: { gate_type: string; width_m: number }[];
  /** Absolute link to the project (where the drawing lives), or null when no link can be built. */
  drawing_url: string | null;
};

export type OutLine = { sl_no: string; description: string; uom: string | null; qty: number; rate: number; discount_pct: number; amount: number };

export type ShapedQuote = {
  lines: OutLine[];
  /** Lines of text for the ERP document's description. */
  description: string[];
  /** True when the fence selection was applied. */
  fence: boolean;
};

const GATE_LABEL: Record<string, string> = { single_swing: "single swing", double_swing: "double swing", sliding: "sliding" };

export function fenceSummaryText(f: FenceInfo): string {
  const parts = [
    f.layout === "open_run" ? "Open run" : "Closed perimeter",
    `${round(f.total_length_m)} m`,
  ];
  if (f.fabric_height_m) parts.push(`fabric ${round(f.fabric_height_m)} m high`);
  if (f.mesh_spec) parts.push(`mesh ${f.mesh_spec}`);
  if (f.coating) parts.push(f.coating);
  const gates = gateSummary(f.gates);
  if (gates) parts.push(gates);
  return parts.join(", ");
}

function gateSummary(gates: FenceInfo["gates"]): string {
  if (!gates.length) return "";
  const byType = new Map<string, number>();
  for (const g of gates) byType.set(g.gate_type, (byType.get(g.gate_type) ?? 0) + 1);
  const bits = [...byType.entries()].map(([t, n]) => `${n} ${GATE_LABEL[t] ?? t} gate${n === 1 ? "" : "s"}`);
  return bits.join(" + ");
}

const round = (n: number) => Math.round(Number(n) * 100) / 100;

/**
 * @param lines   the quote's lines that count toward its total
 * @param base    description lines every quote carries (intro, header terms)
 * @param extras  the quote's notes and terms, used only when the selection asks for them
 */
export function shapeForErp(args: {
  lines: OutLine[];
  base: string[];
  fence: FenceInfo | null;
  selection: FenceSelection;
  notes: string | null;
  terms: string | null;
  subtotal: number;
}): ShapedQuote {
  const { lines, base, fence, selection } = args;
  if (!fence) return { lines, description: base, fence: false };

  const description = [...base];
  if (selection.summary) description.push(`${fence.name}: ${fenceSummaryText(fence)}`);
  if (selection.security_profile && fence.security_profile) description.push(`Security profile: ${fence.security_profile}`);
  if (selection.drawing_link && fence.drawing_url) description.push(`Drawing: ${fence.drawing_url}`);
  if (selection.notes_terms) {
    if (args.notes?.trim()) description.push(`Notes: ${args.notes.trim()}`);
    if (args.terms?.trim()) description.push(`Terms: ${args.terms.trim()}`);
  }

  if (selection.quantity_lines) return { lines, description, fence: true };

  // Quantity lines unticked: one lump line carries the same money, so the
  // ERP total still equals the BPMSquare subtotal.
  const lump: OutLine = {
    sl_no: "1",
    description: `${fence.name} (${fenceSummaryText(fence)})`,
    uom: null,
    qty: 1,
    rate: round(args.subtotal),
    discount_pct: 0,
    amount: round(args.subtotal),
  };
  return { lines: [lump], description, fence: true };
}
