import { createMatcher, MIN_SCORE, type MatchBand } from "@/lib/tender/boq/match";
import { listOutputs, outputKey, splitShares, type AllocationLink, type EstLine, type OutputCost } from "./rules";

// "Allocate to BOQ" (slice 3c-1): a whole-scope estimate (a precast building, a pipeline run) is spread over the BOQ lines it covers.
// PURE: the proposals the panel shows. Two ways to propose:
//   match   each BOQ line takes the estimate line that reads like it (cost code, then words); BOQ lines that took the same estimate
//           line share its cost in proportion to their amount (or quantity)
//   spread  one output (the whole estimate, a WBS group or a line) is spread over the BOQ lines in proportion to their amount
//           (or quantity)
// The panel lets a person untick a row or change a share; the server checks the final set again and gives out no more than 100 percent
// of any output. Shares are percentages of the output and add up to 100 per output at most.

export type BoqInput = { id: string; item_no: string | null; row_no: number; description: string; uom: string | null; qty: number; cost_code: string | null; amount: number };
export type ProposalBy = "amount" | "quantity";
export type Proposal = {
  boq_id: string; item_no: string | null; row_no: number; description: string; qty: number; uom: string | null; amount: number;
  output: string; output_label: string; output_cost: number; band: MatchBand | "spread"; score: number | null; share_pct: number;
};

const weightOf = (b: BoqInput, by: ProposalBy): number => (by === "quantity" ? b.qty : b.amount > 0 ? b.amount : b.qty);

/** The percentage of each output still free once the links NOT being replaced are counted (links on the same BOQ line are replaced). */
export function freePct(existing: readonly AllocationLink[], replacing: ReadonlySet<string>): Map<string, number> {
  const used = new Map<string, number>();
  for (const l of existing) {
    if (l.basis !== "total" || replacing.has(l.boq_line_id)) continue;
    used.set(l.output, (used.get(l.output) ?? 0) + Math.round(l.share_pct * 100));
  }
  return new Map([...used].map(([k, v]) => [k, Math.max(0, (10000 - v) / 100)]));
}

/** Shares in proportion to the weights that add up to at most `free` percent (floored at 2 places so the sum never exceeds it). */
export function sharesWithin(weights: readonly number[], free: number): number[] {
  const whole = splitShares(weights);
  return whole.map((s) => Math.floor(((s * free) / 100) * 100 + 1e-9) / 100);
}

function pack(b: BoqInput, out: OutputCost, share: number, band: Proposal["band"], score: number | null): Proposal {
  return {
    boq_id: b.id, item_no: b.item_no, row_no: b.row_no, description: b.description, qty: b.qty, uom: b.uom, amount: b.amount,
    output: out.key, output_label: out.label, output_cost: out.cost, band, score, share_pct: share,
  };
}

export function proposeByMatch(args: { boq: readonly BoqInput[]; lines: readonly EstLine[]; by: ProposalBy; existing: readonly AllocationLink[]; totalCostFallback?: number | null }): Proposal[] {
  const outputs = new Map(listOutputs(args.lines, args.totalCostFallback ?? null).filter((o) => o.kind === "line").map((o) => [o.key, o]));
  const candidates = args.lines.filter((l) => Number(l.qty) > 0 && outputs.has(outputKey({ kind: "line", id: l.id })));
  const sku = (l: EstLine) => (typeof l.custom_data?.sku === "string" ? (l.custom_data.sku as string) : l.code);
  const match = createMatcher(candidates.map((l) => ({ id: l.id, name: l.description, sku: sku(l), uom: l.uom })));

  const chosen = new Map<string, { b: BoqInput; score: number; band: MatchBand }[]>();
  for (const b of args.boq) {
    const hit = match({ description: b.description, cost_code: b.cost_code, uom: b.uom }, 1)[0];
    if (!hit || hit.score < MIN_SCORE) continue;
    const key = `line:${hit.product_id}`;
    const list = chosen.get(key) ?? [];
    list.push({ b, score: hit.score, band: hit.band });
    chosen.set(key, list);
  }
  const free = freePct(args.existing, new Set(args.boq.map((b) => b.id)));
  const rows: Proposal[] = [];
  for (const [key, list] of chosen) {
    const out = outputs.get(key)!;
    const shares = sharesWithin(list.map((x) => weightOf(x.b, args.by)), free.get(key) ?? 100);
    list.forEach((x, i) => { if (shares[i] > 0) rows.push(pack(x.b, out, shares[i], x.band, x.score)); });
  }
  const order = new Map(args.boq.map((b, i) => [b.id, i]));
  return rows.sort((a, b) => (order.get(a.boq_id) ?? 0) - (order.get(b.boq_id) ?? 0));
}

export function proposeSpread(args: { boq: readonly BoqInput[]; output: OutputCost; by: ProposalBy; existing: readonly AllocationLink[] }): Proposal[] {
  const free = freePct(args.existing, new Set(args.boq.map((b) => b.id))).get(args.output.key) ?? 100;
  const shares = sharesWithin(args.boq.map((b) => weightOf(b, args.by)), free);
  return args.boq.map((b, i) => pack(b, args.output, shares[i], "spread", null)).filter((p) => p.share_pct > 0);
}

/**
 * The shares after a row is ticked or unticked: for each output the ticked rows share what is free, in proportion to amount or
 * quantity. An unticked row gets 0. `existing` is every link the estimate already has; the rows' own lines are being replaced.
 */
export function reshare(rows: readonly Pick<Proposal, "boq_id" | "output" | "amount" | "qty">[], ticked: ReadonlySet<string>, by: ProposalBy, existing: readonly AllocationLink[]): Map<string, number> {
  const free = freePct(existing, new Set(rows.map((r) => r.boq_id)));
  const out = new Map<string, number>(rows.map((r) => [r.boq_id, 0]));
  const groups = new Map<string, typeof rows[number][]>();
  for (const r of rows) if (ticked.has(r.boq_id)) groups.set(r.output, [...(groups.get(r.output) ?? []), r]);
  for (const [output, list] of groups) {
    const shares = sharesWithin(list.map((r) => proposalWeight(r, by)), free.get(output) ?? 100);
    list.forEach((r, i) => out.set(r.boq_id, shares[i]));
  }
  return out;
}

export const proposalWeight = (p: Pick<Proposal, "amount" | "qty">, by: ProposalBy): number => (by === "quantity" ? p.qty : p.amount > 0 ? p.amount : p.qty);
