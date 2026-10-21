import {
  buildBomTable, buildWbsTable, resolveErpProfile, GENERIC_PROFILE,
  type Cell, type ErpExportProfile, type ExportLineInput,
} from "@/lib/estimator/exports";
import { isPriceOnly, selectionContract } from "./contract";
import type { OutLine } from "./fence";
import type { EstimateSelection, TargetKind } from "./types";

// What leaves with an awarded quote that came from an estimate. The BOM and WBS
// rows are built by the estimator's OWN builders and ERP profiles
// (src/lib/estimator/exports.ts) -- not re-implemented here.
//
// Hard rules, enforced here and mirrored in the contract the screen reads:
//  - a Quote target (Dynamics Sales) carries customer prices only: BOM, WBS and
//    internal costs are refused even if ticked;
//  - internal costs go only to a Project target and only when explicitly ticked;
//    with them off the cost columns are removed from the profile, so a unit
//    cost cannot ride along in a BOM or WBS row.

export type EstimateInfo = {
  name: string;
  ref: string | null;
  params: Record<string, number | string | boolean> | null;
  notes: string | null;
  totals: { cost_total: number; margin_pct: number; margin_amount: number; price: number; by_component?: Record<string, number | undefined> } | null;
};

export type Row = Record<string, Cell>;

export type EstimateShape = {
  /** Lines of text for the ERP document's description. */
  description: string[];
  /** Customer-price lines (Quote target only). */
  lines: OutLine[];
  /** WBS tasks keyed by the profile's own column headers (Project target only). */
  tasks: Row[] | null;
  /** BOM lines keyed by the profile's own column headers (Project target only). */
  bom: Row[] | null;
  /** The internal cost breakdown, only when explicitly ticked for a Project target. */
  costs: { label: string; amount: number }[] | null;
  /** Plain list of what is included, for the preview. */
  included: string[];
  /** Ticked options the target refused, each with the plain hint. */
  refused: { part: string; hint: string }[];
};

const COST_FIELDS = new Set(["unit_cost", "line_cost", "planned_cost"]);

function withoutCosts(profile: ErpExportProfile): ErpExportProfile {
  return {
    ...profile,
    columns: {
      bom: profile.columns.bom.filter((c) => !COST_FIELDS.has(c.field)),
      wbs: profile.columns.wbs.filter((c) => !COST_FIELDS.has(c.field)),
    },
  };
}

function toRows(t: { headers: string[]; rows: Cell[][] }): Row[] {
  return t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i] ?? null])));
}

const humanize = (k: string) => k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const money = (n: number) => (Math.round(Number(n) * 100) / 100).toFixed(2);
const roundMoney = (n: number) => Math.round(Number(n) * 100) / 100;

export function estimateSummaryText(e: EstimateInfo): string[] {
  const out: string[] = [];
  const params = Object.entries(e.params ?? {}).filter(([, v]) => v !== "" && v !== null && v !== undefined).slice(0, 8);
  if (params.length) out.push(`${e.ref ? `${e.ref} · ` : ""}${e.name}: ${params.map(([k, v]) => `${humanize(k)} ${typeof v === "boolean" ? (v ? "yes" : "no") : v}`).join(", ")}`);
  else out.push(`${e.ref ? `${e.ref} · ` : ""}${e.name}`);
  if (e.notes?.trim()) out.push(`Note: ${e.notes.trim().split(/\r?\n/)[0].slice(0, 300)}`);
  return out;
}

const COMPONENT_LABEL: Record<string, string> = {
  materials: "Materials", moulds: "Moulds", transport: "Transport", erection: "Erection", overhead: "Overhead", labour: "Labour", other: "Other",
};

export function costBreakdown(e: EstimateInfo): { label: string; amount: number }[] | null {
  const t = e.totals;
  if (!t) return null;
  const rows = Object.entries(t.by_component ?? {})
    .filter(([, v]) => typeof v === "number" && v !== 0)
    .map(([k, v]) => ({ label: COMPONENT_LABEL[k] ?? humanize(k), amount: roundMoney(v as number) }));
  rows.push({ label: "Cost total", amount: roundMoney(t.cost_total) });
  if (t.margin_amount) rows.push({ label: `Margin (${t.margin_pct}%)`, amount: roundMoney(t.margin_amount) });
  return rows;
}

export function shapeEstimate(a: {
  target: TargetKind;
  selection: EstimateSelection;
  estimate: EstimateInfo;
  /** The estimate's lines as the estimator's builders take them. */
  exportLines: readonly ExportLineInput[];
  /** The Standard Quote's customer-price lines. */
  quoteLines: OutLine[];
  quoteSubtotal: number;
  /** estimator ERP profile key; unknown falls back to generic. */
  profileKey: string;
}): EstimateShape {
  const contract = selectionContract(a.target).estimate;
  const refused: EstimateShape["refused"] = [];
  const want = (part: keyof EstimateSelection): boolean => {
    if (!a.selection[part]) return false;
    if (!contract[part].allowed) {
      // Only the internal costs are worth reporting when a target refuses them: bom and
      // wbs are on by default and simply do not apply to a Quote, and a project has no
      // price lines. Costs are a deliberate opt-in that must not silently vanish.
      if (isPriceOnly(a.target) && part === "internal_costs") refused.push({ part, hint: contract[part].hint ?? "" });
      return false;
    }
    return true;
  };

  const included: string[] = [];
  const description: string[] = [];
  if (want("summary")) { description.push(...estimateSummaryText(a.estimate)); included.push("Estimate summary"); }

  let lines: OutLine[] = [];
  if (isPriceOnly(a.target)) {
    if (want("quote_lines")) { lines = a.quoteLines; included.push("Quote lines at customer prices"); }
    else {
      lines = [{
        sl_no: "1", description: a.estimate.name, uom: null, qty: 1, rate: roundMoney(a.quoteSubtotal), discount_pct: 0, amount: roundMoney(a.quoteSubtotal),
      }];
      included.push("One line with the quote total");
    }
  }

  // The internal costs are decided first: with them off, the cost columns are
  // taken out of the profile before any row is built.
  const costsOn = want("internal_costs");
  const base = resolveErpProfile(a.profileKey) ?? GENERIC_PROFILE;
  const profile = costsOn ? base : withoutCosts(base);

  let tasks: Row[] | null = null;
  let bom: Row[] | null = null;
  if (want("wbs")) { tasks = toRows(buildWbsTable(a.exportLines, profile)); included.push(`${tasks.length} project task${tasks.length === 1 ? "" : "s"} (WBS)`); }
  if (want("bom")) { bom = toRows(buildBomTable(a.exportLines, profile)); included.push(`${bom.length} bill of materials line${bom.length === 1 ? "" : "s"}`); }

  let costs: EstimateShape["costs"] = null;
  if (costsOn) {
    costs = costBreakdown(a.estimate);
    if (costs) {
      description.push(`Internal costs: ${costs.map((c) => `${c.label} ${money(c.amount)}`).join(", ")}`);
      included.push("Internal cost breakdown");
    }
  }
  return { description, lines, tasks, bom, costs, included, refused };
}
