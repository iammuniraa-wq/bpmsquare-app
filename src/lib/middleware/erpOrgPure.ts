// The pure half of the ERP organisation mapping (SO4a, docs/design/sales-order.md): the key scheme of the two org value lists, their
// validation, the lookup order, and the words the screens use. No server imports, so the Mapping tab, the order screen and the tests
// all read the same rules. The server half (resolveErpOrg) is src/lib/middleware/erpOrg.ts.
//
// KEY SCHEME. An org list is a normal value list (BPMSquare value | ERP code), but its BPMSquare side is never typed: it is a stable key
//   segment:<uuid>      a coverage, by the id of its SEGMENT ("Saudi retail"), not of the coverage row. A coverage row is effective-
//                       dated and is ended and re-made when a team changes; the segment is the market, and it survives that.
//   order_type:<uuid>   a sales order type.
// The screen shows the current NAME of the target and a row whose target is gone says "(removed)". Renaming never breaks a row.

import { ORG_LIST_KINDS } from "./mapping/types";

export type ErpOrgKind = (typeof ORG_LIST_KINDS)[number];

export type ErpOrgResult =
  | { ok: true; code: string; via: "coverage" | "order_type"; key: string; /** The name of the coverage or order type the code came from. */ via_label?: string }
  | { ok: false; reason: string };

/** One code on a coverage or order type, for the read-only chip on the Coverage and Order types screens. */
export type ErpOrgChip = { kind: ErpOrgKind; label: string; connection: string; code: string };

export const ORG_KIND_LABEL: Record<ErpOrgKind, string> = { sales_area: "Sales area", erp_company: "ERP company" };
export const isOrgKind = (v: unknown): v is ErpOrgKind => typeof v === "string" && (ORG_LIST_KINDS as readonly string[]).includes(v);

/** Which org list a connection (the value-list connection id) takes. SAP has sales areas; Dynamics has companies / business units. */
export function orgKindsFor(connection: string): ErpOrgKind[] {
  if (connection === "sap_s4" || connection === "sap") return ["sales_area"];
  if (connection === "dynamics365") return ["erp_company"];
  return [];
}

// ── SAP sales area ────────────────────────────────────────────────────────────

export type SalesAreaParts = { salesOrganization: string; distributionChannel: string; division: string; salesGroup?: string; salesOffice?: string };

/** A SAP sales area code "1000/10/00" or "1000/10/00/G01/O01" split into its parts; null when malformed. */
export function parseSalesArea(code: string): SalesAreaParts | null {
  const p = String(code ?? "").split("/").map((s) => s.trim());
  if (p.length < 3 || p.length > 5 || p.slice(0, 3).some((s) => !/^[A-Za-z0-9]{1,4}$/.test(s))) return null;
  // Sales group and office are 3 and 4 characters in SAP; an empty segment is not a value.
  if (p.slice(3).some((s) => !/^[A-Za-z0-9]{1,4}$/.test(s))) return null;
  const out: SalesAreaParts = { salesOrganization: p[0], distributionChannel: p[1], division: p[2] };
  if (p[3]) out.salesGroup = p[3];
  if (p[4]) out.salesOffice = p[4];
  return out;
}

/** The row error for a sales area code that is not in the form SAP needs; null when it is fine (or empty: an empty code only blocks the send). */
export function salesAreaProblem(code: string): string | null {
  const c = String(code ?? "").trim();
  if (!c) return null;
  return parseSalesArea(c) ? null : `'${c.slice(0, 40)}' is not a sales area. Write it as ORGANISATION/CHANNEL/DIVISION, for example 1000/10/00 (a sales group and office may follow).`;
}

// ── The key ───────────────────────────────────────────────────────────────────

export type OrgKeyType = "segment" | "order_type";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const orgKey = (type: OrgKeyType, id: string): string => `${type}:${String(id).toLowerCase()}`;

export function parseOrgKey(v: unknown): { type: OrgKeyType; id: string } | null {
  if (typeof v !== "string") return null;
  const m = /^(segment|order_type):(.+)$/.exec(v.trim());
  if (!m || !UUID.test(m[2])) return null;
  return { type: m[1] as OrgKeyType, id: m[2].toLowerCase() };
}

/** The current names of the things a key can point at (every segment and order type of the workspace). */
export type OrgNames = { segment: Record<string, string>; order_type: Record<string, string> };
export const EMPTY_NAMES: OrgNames = { segment: {}, order_type: {} };

export type OrgKeyLabel = { label: string; group: "Coverage" | "Order type"; removed: boolean };

/** What the screen calls a key: the target's current name, or a visible "(removed)" when it is gone. */
export function orgKeyLabel(key: string, names: OrgNames): OrgKeyLabel {
  const k = parseOrgKey(key);
  if (!k) return { label: "(not a coverage or order type)", group: "Coverage", removed: true };
  const group = k.type === "segment" ? "Coverage" : "Order type";
  const name = names[k.type][k.id];
  return name ? { label: name, group, removed: false } : { label: `(removed ${group.toLowerCase()})`, group, removed: true };
}

/** A name a person typed in a CSV, back to a key: an exact (case-insensitive) unique name of a coverage or order type, or a key itself. */
export function keyFromText(text: string, names: OrgNames): { ok: true; key: string } | { ok: false; message: string } {
  const t = String(text ?? "").trim();
  if (!t) return { ok: false, message: "Name a coverage or an order type." };
  const asKey = parseOrgKey(t);
  if (asKey) return { ok: true, key: orgKey(asKey.type, asKey.id) };
  const hits: string[] = [];
  for (const type of ["segment", "order_type"] as const) {
    for (const [id, name] of Object.entries(names[type])) if (name.trim().toLowerCase() === t.toLowerCase()) hits.push(orgKey(type, id));
  }
  if (hits.length === 1) return { ok: true, key: hits[0] };
  return { ok: false, message: hits.length ? `'${t}' is both a coverage and an order type: use the pick list.` : `'${t}' is not a coverage or an order type of this workspace.` };
}

// ── Validation (the pure part of a save) ──────────────────────────────────────

export type OrgRowError = { row: number; message: string };

/** The rules an org list adds to the ordinary list rules: the BPMSquare side is a valid key and a sales area code has the SAP form. */
export function validateOrgRows(kind: ErpOrgKind, rows: readonly { bpm: string; erp: string }[]): OrgRowError[] {
  const out: OrgRowError[] = [];
  rows.forEach((r, i) => {
    if (!parseOrgKey(r.bpm)) { out.push({ row: i, message: "Pick a coverage or an order type for this row." }); return; }
    if (kind === "sales_area") {
      const p = salesAreaProblem(r.erp);
      if (p) out.push({ row: i, message: p });
    }
  });
  return out;
}

// ── Which row answers ─────────────────────────────────────────────────────────

type CodeRow = { bpm: string; erp: string };

/** The order type's row first, then the coverage's. A row without a code does not answer (it is shown red on the Mapping tab). */
export function pickOrgCode(
  rows: readonly CodeRow[],
  keys: { orderTypeKey: string | null; coverageKey: string | null },
): { code: string; via: "coverage" | "order_type"; key: string } | null {
  const find = (key: string | null) => (key ? rows.find((r) => r.bpm.toLowerCase() === key.toLowerCase() && r.erp.trim() !== "") ?? null : null);
  const ot = find(keys.orderTypeKey);
  if (ot) return { code: ot.erp.trim(), via: "order_type", key: ot.bpm.toLowerCase() };
  const cov = find(keys.coverageKey);
  if (cov) return { code: cov.erp.trim(), via: "coverage", key: cov.bpm.toLowerCase() };
  return null;
}

const MAPPING_WHERE = "Add one under Settings, Integration middleware, Mapping, Value mapping.";

/** The plain sentence for "no code": names what was looked for, so a person knows which row to add. */
export function noMappingReason(
  kind: ErpOrgKind,
  what: { listEmpty?: boolean; orderTypeName?: string | null; coverageName?: string | null; hadAccount?: boolean },
): string {
  const word = ORG_KIND_LABEL[kind].toLowerCase();
  if (what.listEmpty) return `No ${word} is mapped on this ERP yet. ${MAPPING_WHERE}`;
  const ot = what.orderTypeName ? `order type '${what.orderTypeName}'` : null;
  const cov = what.coverageName ? `coverage '${what.coverageName}'` : null;
  if (ot && cov) return `No ${word} is mapped for ${ot} or ${cov} on this ERP. ${MAPPING_WHERE}`;
  if (cov) return `No ${word} is mapped for ${cov} on this ERP. ${MAPPING_WHERE}`;
  if (ot) return `No ${word} is mapped for ${ot} on this ERP, and this customer has no coverage. ${MAPPING_WHERE}`;
  return what.hadAccount === false
    ? `No ${word} can be found: the order has no customer and no order type with a mapping.`
    : `No ${word} can be found: this customer has no coverage and the order type has no mapping.`;
}

// ── The words a screen shows ──────────────────────────────────────────────────

export type ErpOrgLine = { ok: boolean; text: string };

/** "Sales area 1000/10/00 (from coverage Saudi retail)", or the reason when there is no code. One sentence for the order's ERP tab. */
export function describeErpOrg(result: ErpOrgResult, kind: ErpOrgKind = "sales_area"): ErpOrgLine {
  if (!result.ok) return { ok: false, text: result.reason };
  const from = result.via === "order_type" ? "order type" : "coverage";
  return { ok: true, text: `${ORG_KIND_LABEL[kind]} ${result.code}${result.via_label ? ` (from ${from} ${result.via_label})` : ""}` };
}
