// BOM and WBS export builders (docs/estimator-architecture.md §5).
//
// INTERNAL ONLY. These carry unit costs and line costs, so they are for the
// estimator's own users (admin/estimator roles) and the tenant's ERP people.
// They are never part of a customer-facing document, a Standard Quote, a PDF
// or the v1 API.
//
// ERP-agnostic by design: the ERP is whatever the tenant uses (Dynamics 365,
// SAP, Epicor/Epromis, none). The builders produce GENERIC rows once; an
// `ErpExportProfile` is only a named mapping from those generic fields to the
// column headers an ERP's import wants, chosen per request (`?profile=`), with
// "generic" as the default (a tenant setting will pick the default later). A
// new ERP is one more profile object -- no builder change.
//
// Rounding follows compute.ts: quantities 3 dp, money 2 dp, unit costs 4 dp.
// The BOM `quantity` is the GROSS quantity (net plus waste), i.e. what is
// procured, so quantity * unit_cost = line_cost.

import { roundHalfAway } from "./formula";
import { roundMoney, roundQty, UNIT_COST_DP } from "./compute";
import { groupSlug } from "./types";
import type { EstimateComponent } from "./types";

// ── Input ────────────────────────────────────────────────────────────────────

/** What a builder needs of a line. A ComputedLine, or an estimate_lines row
 *  joined to its product's SKU and its group's display name, fits. */
export type ExportLineInput = {
  code?: string | null;
  /** The product's SKU (the ERP item number when it came from a connector). */
  sku?: string | null;
  description: string;
  uom?: string | null;
  /** Net quantity. */
  qty: number;
  waste_pct?: number | null;
  unit_cost?: number | null;
  cost_total?: number | null;
  group?: string | null;
  group_key?: string | null;
  component?: EstimateComponent | null;
  element_ref?: string | null;
  sort_order?: number | null;
};

// ── Generic rows ─────────────────────────────────────────────────────────────

export type BomField =
  | "item_number" | "description" | "quantity" | "unit" | "group" | "wbs_code" | "element_ref" | "unit_cost" | "line_cost";

export type WbsField = "code" | "parent" | "name" | "group" | "planned_cost";

export type Cell = string | number | null;
export type BomRow = Record<BomField, Cell>;
export type WbsRow = Record<WbsField, Cell>;

const UNGROUPED = "Ungrouped";

type GroupInfo = { key: string; name: string; code: string };
type NumberedLine = { line: ExportLineInput; group: GroupInfo; wbs: string; qty_gross: number };

/** Number groups by order of first appearance (1, 2, ...) and lines inside a
 *  group (1.1, 1.2, ...). Zero-quantity lines are not exported at all. */
function numberLines(lines: readonly ExportLineInput[]): { numbered: NumberedLine[]; groups: GroupInfo[] } {
  const ordered = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => Number.isFinite(line.qty) && line.qty > 0)
    .sort((a, b) => (a.line.sort_order ?? a.i) - (b.line.sort_order ?? b.i) || a.i - b.i)
    .map(({ line }) => line);
  const groups = new Map<string, GroupInfo>();
  const counts = new Map<string, number>();
  const numbered: NumberedLine[] = [];
  for (const line of ordered) {
    const name = (line.group ?? "").trim() || UNGROUPED;
    const key = (line.group_key ?? "").trim() || groupSlug(name) || "ungrouped";
    let g = groups.get(key);
    if (!g) {
      g = { key, name, code: String(groups.size + 1) };
      groups.set(key, g);
    }
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    numbered.push({
      line,
      group: g,
      wbs: `${g.code}.${n}`,
      qty_gross: roundQty(line.qty * (1 + (line.waste_pct ?? 0) / 100)),
    });
  }
  return { numbered, groups: [...groups.values()] };
}

const money = (x: number | null | undefined): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : roundMoney(x));

/** Is this line a physical thing the factory or the buyer handles? Labour,
 *  transport, erection and overhead are WBS tasks, not BOM items. */
function isBomItem(l: ExportLineInput): boolean {
  if (l.sku) return true;
  return l.component === "materials" || l.component === "moulds";
}

export type BomOptions = {
  /** "items" (default): physical items only. "all": every line, including
   *  labour, transport, erection and overhead. */
  include?: "items" | "all";
};

/** BOM export rows (spec §5.1 columns). */
export function buildBomRows(lines: readonly ExportLineInput[], opts: BomOptions = {}): BomRow[] {
  const { numbered } = numberLines(lines);
  return numbered
    .filter(({ line }) => (opts.include ?? "items") === "all" || isBomItem(line))
    .map(({ line, group, wbs, qty_gross }) => ({
      item_number: line.sku?.trim() || null,
      description: line.description,
      quantity: qty_gross,
      unit: line.uom?.trim() || null,
      group: group.name,
      wbs_code: wbs,
      element_ref: line.element_ref?.trim() || null,
      unit_cost: line.unit_cost === null || line.unit_cost === undefined || !Number.isFinite(line.unit_cost)
        ? null
        : roundHalfAway(line.unit_cost, UNIT_COST_DP),
      line_cost: money(line.cost_total),
    }));
}

export type WbsOptions = {
  /** 1: groups only. 2 (default): groups and a task per line. */
  depth?: 1 | 2;
};

/** WBS export rows: each group is a top-level element, each line (optionally)
 *  a task under it. Codes come from group order (1, 1.1, 1.2, 2, 2.1, ...). */
export function buildWbsRows(lines: readonly ExportLineInput[], opts: WbsOptions = {}): WbsRow[] {
  const { numbered, groups } = numberLines(lines);
  const rows: WbsRow[] = [];
  for (const g of groups) {
    const mine = numbered.filter((n) => n.group.key === g.key);
    const priced = mine.map((n) => n.line.cost_total).filter((c): c is number => c !== null && c !== undefined && Number.isFinite(c));
    rows.push({
      code: g.code,
      parent: null,
      name: g.name,
      group: g.name,
      planned_cost: roundMoney(priced.reduce((a, b) => a + b, 0)),
    });
    if ((opts.depth ?? 2) === 2) {
      for (const n of mine) {
        rows.push({
          code: n.wbs,
          parent: g.code,
          name: n.line.description,
          group: g.name,
          planned_cost: money(n.line.cost_total),
        });
      }
    }
  }
  return rows;
}

// ── ERP export profiles ──────────────────────────────────────────────────────

export type ErpColumn<F extends string> = { header: string; field: F };

export type ErpExportProfile = {
  key: string;
  label: string;
  /** Shown beside the profile picker. */
  note: string;
  columns: {
    bom: ErpColumn<BomField>[];
    wbs: ErpColumn<WbsField>[];
  };
};

const CONFIRM = "A best-effort starting mapping: confirm the exact column names and required fields with your ERP consultant before loading.";

export const GENERIC_PROFILE: ErpExportProfile = {
  key: "generic",
  label: "Generic",
  note: "The estimator's own column names; map them in whatever import tool your ERP uses.",
  columns: {
    bom: [
      { header: "item_number", field: "item_number" },
      { header: "description", field: "description" },
      { header: "quantity", field: "quantity" },
      { header: "unit", field: "unit" },
      { header: "group", field: "group" },
      { header: "wbs_code", field: "wbs_code" },
      { header: "element_ref", field: "element_ref" },
      { header: "unit_cost", field: "unit_cost" },
      { header: "line_cost", field: "line_cost" },
    ],
    wbs: [
      { header: "code", field: "code" },
      { header: "parent", field: "parent" },
      { header: "name", field: "name" },
      { header: "group", field: "group" },
      { header: "planned_cost", field: "planned_cost" },
    ],
  },
};

export const DYNAMICS365_PROFILE: ErpExportProfile = {
  key: "dynamics365",
  label: "Microsoft Dynamics 365",
  note: `Headers named for Dynamics BOM-line and project WBS-task imports. ${CONFIRM}`,
  columns: {
    bom: [
      { header: "ItemNumber", field: "item_number" },
      { header: "Description", field: "description" },
      { header: "Quantity", field: "quantity" },
      { header: "UnitSymbol", field: "unit" },
      { header: "LineGroup", field: "group" },
      { header: "WBSId", field: "wbs_code" },
      { header: "ElementReference", field: "element_ref" },
      { header: "CostPrice", field: "unit_cost" },
      { header: "LineAmount", field: "line_cost" },
    ],
    wbs: [
      { header: "WBSId", field: "code" },
      { header: "ParentWBSId", field: "parent" },
      { header: "TaskName", field: "name" },
      { header: "TaskGroup", field: "group" },
      { header: "PlannedCost", field: "planned_cost" },
    ],
  },
};

export const SAP_PROFILE: ErpExportProfile = {
  key: "sap",
  label: "SAP",
  note: `Headers styled on SAP material (MATNR, MENGE, MEINS) and project WBS element (PSPNR) fields; Z-prefixed columns are placeholders for customer fields. ${CONFIRM}`,
  columns: {
    bom: [
      { header: "MATNR", field: "item_number" },
      { header: "MAKTX", field: "description" },
      { header: "MENGE", field: "quantity" },
      { header: "MEINS", field: "unit" },
      { header: "ZGROUP", field: "group" },
      { header: "PSPNR", field: "wbs_code" },
      { header: "ZELEMENT_REF", field: "element_ref" },
      { header: "NETPR", field: "unit_cost" },
      { header: "NETWR", field: "line_cost" },
    ],
    wbs: [
      { header: "PSPNR", field: "code" },
      { header: "PSPNR_PARENT", field: "parent" },
      { header: "POST1", field: "name" },
      { header: "ZGROUP", field: "group" },
      { header: "PLANNED_COST", field: "planned_cost" },
    ],
  },
};

export const ERP_EXPORT_PROFILES: Readonly<Record<string, ErpExportProfile>> = {
  generic: GENERIC_PROFILE,
  dynamics365: DYNAMICS365_PROFILE,
  sap: SAP_PROFILE,
};

export const DEFAULT_ERP_PROFILE = "generic";

/**
 * The profile for a `?profile=` value. Empty or missing means the default;
 * an unknown key returns null so the caller can answer 400 instead of quietly
 * exporting the wrong columns.
 */
export function resolveErpProfile(key: string | null | undefined, tenantDefault?: string | null): ErpExportProfile | null {
  const wanted = (key ?? "").trim().toLowerCase() || (tenantDefault ?? "").trim().toLowerCase() || DEFAULT_ERP_PROFILE;
  return Object.prototype.hasOwnProperty.call(ERP_EXPORT_PROFILES, wanted) ? ERP_EXPORT_PROFILES[wanted] : null;
}

// ── Tables ───────────────────────────────────────────────────────────────────

export type ExportTable = { headers: string[]; rows: Cell[][] };

function project<F extends string>(rows: readonly Record<F, Cell>[], columns: readonly ErpColumn<F>[]): ExportTable {
  return {
    headers: columns.map((c) => c.header),
    rows: rows.map((r) => columns.map((c) => r[c.field] ?? null)),
  };
}

export function buildBomTable(lines: readonly ExportLineInput[], profile: ErpExportProfile = GENERIC_PROFILE, opts: BomOptions = {}): ExportTable {
  return project(buildBomRows(lines, opts), profile.columns.bom);
}

export function buildWbsTable(lines: readonly ExportLineInput[], profile: ErpExportProfile = GENERIC_PROFILE, opts: WbsOptions = {}): ExportTable {
  return project(buildWbsRows(lines, opts), profile.columns.wbs);
}

// ── Writers ──────────────────────────────────────────────────────────────────

/** A text cell that starts with = + - @ (or a tab/CR) is run as a formula by
 *  Excel and LibreOffice; item descriptions are user text, so neutralise it. */
function csvText(s: string): string {
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvCell(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (typeof c === "number") return Number.isFinite(c) ? String(c) : "";
  return csvText(c);
}

/** RFC 4180 CSV, CRLF line ends, numbers written plainly with a dot. */
export function tableToCsv(table: ExportTable, opts: { bom?: boolean } = {}): string {
  const lines = [table.headers.map(csvText).join(","), ...table.rows.map((r) => r.map(csvCell).join(","))];
  return `${opts.bom ? "﻿" : ""}${lines.join("\r\n")}\r\n`;
}

/** One-sheet workbook. Numbers stay numeric cells; text is stored as text,
 *  which Excel does not evaluate, so no formula-injection prefix is needed. */
export async function tableToXlsx(table: ExportTable, sheetName: string): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Export");
  const header = ws.addRow(table.headers);
  header.font = { bold: true };
  for (const r of table.rows) ws.addRow(r.map((c) => (c === null ? null : c)));
  ws.columns.forEach((col, i) => {
    const longest = Math.max(table.headers[i]?.length ?? 8, ...table.rows.slice(0, 200).map((r) => String(r[i] ?? "").length));
    col.width = Math.min(Math.max(longest + 2, 10), 60);
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export type ExportKind = "bom" | "wbs";
export type ExportFormat = "csv" | "xlsx";

/** `EST-0001-bom-generic.csv`: safe for a Content-Disposition header. */
export function exportFilename(ref: string | null | undefined, kind: ExportKind, profileKey: string, format: ExportFormat): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${clean(ref ?? "") || "estimate"}-${kind}-${clean(profileKey) || DEFAULT_ERP_PROFILE}.${format}`;
}
