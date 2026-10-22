import { D365_DEFAULTS, D365_OUTBOUND_PRESETS, entityConfig, outboundConfig } from "@/lib/connectors/d365/catalog";
import type { D365Config, D365EntityKey, D365OrderConfig, D365OutboundConfig } from "@/lib/connectors/d365/types";
import { resolveTarget } from "./contract";
import { PRODUCT_SHORT } from "./links";
import { missingRequired, type ErpField } from "./metadata";
import { LINE_PLACEHOLDERS, PROJECT_PLACEHOLDERS, QUOTE_PLACEHOLDERS, validateOutboundMap, type MapKind } from "./payload";
import { TARGET_LABEL, type TargetKind } from "./types";

// The Mapping tab as two columns, one row per field (spec section 6): BPMSquare field | ERP field. The stored map
// stays the form the engine reads (`ERP field = template` for what BPMSquare sends, `BPM field = ERP field` for
// what it pulls); this file inverts it per row for the screen and rebuilds it on save. Pure.

export const MAPPING_DOCS = ["quote", "customers", "contacts", "products", "projects"] as const;
export type MappingDocKey = (typeof MAPPING_DOCS)[number];
export const isMappingDoc = (v: unknown): v is MappingDocKey => typeof v === "string" && (MAPPING_DOCS as readonly string[]).includes(v);

export type ErpFieldRef = { label: string; name: string };
export type MapRow = {
  /** `<placeholder>` for a plain row; `composite:<erp field>` or `extra:<erp field>` for a read-only one. */
  id: string;
  bpm: { label: string; name: string };
  erp: ErpFieldRef | null;
  /** The row is the standard (preset) mapping. */
  standard: boolean;
  /** A template built from more than one field (or fixed text): shown read-only until the mapping is reset. */
  composite?: string;
};
export type MapSection = { key: "header" | "lines"; label: string; rows: MapRow[] };
export type MappingView = {
  document: { key: MappingDocKey; label: string; targetLabel: string };
  sections: MapSection[];
  erpFields: { header: ErpFieldRef[]; lines: ErpFieldRef[] };
  usingStandard: boolean;
  missingRequired: string[];
  /** Finance and Operations / Business Central only: the entity a project or sales order is created in. */
  settings: { entity_set: string; id_field: string } | null;
};

export const QUOTE_LABELS: Record<string, string> = {
  name: "Name", ref: "Reference", title: "Title", customer_name: "Customer", account_external_id: "Customer link", description: "Description",
  summary: "Summary", total: "Total", subtotal: "Subtotal", valid_until: "Valid until", outcome: "Outcome", status: "Status",
};
export const LINE_LABELS: Record<string, string> = {
  description: "Description", qty: "Quantity", rate: "Rate", net_rate: "Net rate", uom: "Unit", amount: "Amount", discount_pct: "Discount %", sl_no: "Line number",
};
export const INBOUND_LABELS: Record<string, string> = {
  name: "Name", city: "City", phone: "Phone", email: "Email", role: "Role", sku: "SKU", uom: "Unit", list_price: "List price", description: "Description",
  code: "Code", account_external_id: "Customer link",
};
export const INBOUND_FIELDS: Record<string, readonly string[]> = {
  customers: ["name", "city", "phone", "email"],
  contacts: ["name", "phone", "email", "role", "account_external_id"],
  products: ["name", "sku", "uom", "list_price", "description"],
  projects: ["name", "code", "account_external_id"],
};
export const INBOUND_LABEL_WORD: Record<string, string> = { customers: "Customers", contacts: "Contacts", products: "Products", projects: "Projects" };

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(@odata\.bind)?$/;
const PULL_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_.]*(@odata\.bind)?$/;
const stripBind = (f: string) => f.replace(/@odata\.bind$/, "");

const withLabel = (name: string, known: readonly ErpFieldRef[]): ErpFieldRef => known.find((f) => f.name === name) ?? { label: name, name };

/** Does `name` exist in the ERP's field list? A Dataverse lookup is bound by navigation property (`customerid_account@odata.bind`) while its
 *  attribute is `customerid`, so a bound name is accepted when its base starts with a listed field. */
export function knownErpField(name: string, list: readonly ErpFieldRef[]): boolean {
  if (!list.length) return true;
  const base = stripBind(name).toLowerCase();
  return list.some((f) => {
    const n = f.name.toLowerCase();
    return n === base || (name.endsWith("@odata.bind") && base.startsWith(`${n}_`));
  });
}

// ── Which outbound map the Quote document edits ─────────────────────────────

export type QuoteKinds = { header: MapKind; lines: MapKind | null; targetKey: TargetKind };

/** The maps behind the Quote document, for the target in force. */
export function quoteKinds(product: D365Config["product"], target: TargetKind): QuoteKinds {
  if (product === "dataverse") return target === "sales_order" ? { header: "sales_order", lines: "sales_order_line", targetKey: target } : { header: "quote", lines: "quote_line", targetKey: "quote" };
  return { header: target === "sales_order" ? "sales_order" : "project", lines: null, targetKey: target === "sales_order" ? "sales_order" : "project" };
}

export const placeholdersOf = (k: MapKind): readonly string[] => (k === "quote_line" || k === "sales_order_line" ? LINE_PLACEHOLDERS : k === "project" ? PROJECT_PLACEHOLDERS : QUOTE_PLACEHOLDERS);
export const labelsOf = (k: MapKind) => (k === "quote_line" || k === "sales_order_line" ? LINE_LABELS : QUOTE_LABELS);

/** The map in force for one outbound kind, and the standard one. */
export function outboundMaps(cfg: Pick<D365Config, "product" | "outbound" | "orders">, kind: MapKind): { effective: Record<string, string>; standard: Record<string, string>; custom: boolean } {
  const eff = outboundConfig(cfg);
  const std = D365_OUTBOUND_PRESETS[cfg.product];
  return {
    effective: kind === "project" ? eff.project.field_map : eff[kind].field_map,
    standard: kind === "project" ? std.project.field_map : std[kind].field_map,
    custom: eff.custom[kind],
  };
}

// ── Inversion ───────────────────────────────────────────────────────────────

const PURE = /^\{([a-z_]+)\}$/;

/** `{ref} · {summary}` as words: "Reference · Summary". Fixed text stays as it is. */
export function describeTemplate(tpl: string, labels: Record<string, string>): string {
  if (tpl.trim() === "true" || tpl.trim() === "false") return `Fixed value (${tpl.trim()})`;
  return tpl.replace(/\{([a-z_]+)\}/g, (_m, k: string) => labels[k] ?? k);
}

export function invertOutbound(map: Record<string, string>, standard: Record<string, string>, placeholders: readonly string[], labels: Record<string, string>, known: readonly ErpFieldRef[]): MapRow[] {
  const byPlaceholder = new Map<string, string[]>();
  const composites: [string, string][] = [];
  for (const [erp, tpl] of Object.entries(map)) {
    const m = PURE.exec(tpl.trim());
    if (m && placeholders.includes(m[1])) byPlaceholder.set(m[1], [...(byPlaceholder.get(m[1]) ?? []), erp]);
    else composites.push([erp, tpl]);
  }
  const stdBy = new Map<string, string>();
  for (const [erp, tpl] of Object.entries(standard)) {
    const m = PURE.exec(tpl.trim());
    if (m && !stdBy.has(m[1])) stdBy.set(m[1], erp);
  }
  const rows: MapRow[] = [];
  for (const p of placeholders) {
    const fields = byPlaceholder.get(p) ?? [];
    const bpm = { label: labels[p] ?? p, name: p };
    rows.push({ id: p, bpm, erp: fields[0] ? withLabel(fields[0], known) : null, standard: (fields[0] ?? null) === (stdBy.get(p) ?? null) });
    for (const extra of fields.slice(1)) {
      rows.push({ id: `extra:${extra}`, bpm, erp: withLabel(extra, known), standard: standard[extra] === `{${p}}`, composite: `{${p}}` });
    }
  }
  for (const [erp, tpl] of composites) {
    rows.push({ id: `composite:${erp}`, bpm: { label: describeTemplate(tpl, labels), name: tpl }, erp: withLabel(erp, known), standard: standard[erp] === tpl, composite: tpl });
  }
  return rows;
}

export type RowError = { id: string; message: string };

const READ_ONLY = "This row is built from more than one field. Reset to standard to change it.";

/** Apply submitted rows to a map: returns the new map, or the errors naming each row. Nothing is dropped silently. */
export function applyOutboundRows(
  kind: MapKind, map: Record<string, string>, rows: { id: string; erp: string | null }[], known: readonly ErpFieldRef[], labels: Record<string, string>,
): { ok: true; map: Record<string, string> } | { ok: false; errors: RowError[] } {
  const placeholders = placeholdersOf(kind);
  const errors: RowError[] = [];
  const next: Record<string, string> = { ...map };
  const seen = new Set<string>();
  const changes: { id: string; erp: string | null }[] = [];
  for (const r of rows) {
    if (typeof r?.id !== "string") { errors.push({ id: String(r?.id), message: "Unknown row." }); continue; }
    if (seen.has(r.id)) { errors.push({ id: r.id, message: "This row was sent twice." }); continue; }
    seen.add(r.id);
    if (r.id.startsWith("composite:") || r.id.startsWith("extra:")) { errors.push({ id: r.id, message: READ_ONLY }); continue; }
    if (!placeholders.includes(r.id)) { errors.push({ id: r.id, message: "This row is not part of the mapping." }); continue; }
    if (r.erp !== null && typeof r.erp !== "string") { errors.push({ id: r.id, message: "Choose an ERP field or Not sent." }); continue; }
    if (r.erp !== null) {
      const name = r.erp.trim();
      if (!FIELD_RE.test(name) || name.length > 120) { errors.push({ id: r.id, message: `${labels[r.id] ?? r.id}: that is not a valid ERP field name.` }); continue; }
      if ((kind === "quote_line" || kind === "sales_order_line") && /^uomid(@odata\.bind)?$/i.test(name)) { errors.push({ id: r.id, message: `${labels[r.id] ?? r.id}: a write-in line must not carry a unit of measure (Dynamics refuses it).` }); continue; }
      if (!knownErpField(name, known)) { errors.push({ id: r.id, message: `${labels[r.id] ?? r.id}: ${name} is not a field in the ERP.` }); continue; }
      changes.push({ id: r.id, erp: name });
    } else changes.push({ id: r.id, erp: null });
  }
  if (errors.length) return { ok: false, errors };

  // Take away each changed row's current (first) mapping, then add the new ones, so two rows can swap fields.
  for (const c of changes) {
    const current = Object.entries(next).find(([, tpl]) => tpl.trim() === `{${c.id}}`);
    if (current) delete next[current[0]];
  }
  for (const c of changes) {
    if (c.erp === null) continue;
    if (next[c.erp] !== undefined) { errors.push({ id: c.id, message: `${labels[c.id] ?? c.id}: ${c.erp} is already filled by another row.` }); continue; }
    next[c.erp] = `{${c.id}}`;
  }
  if (errors.length) return { ok: false, errors };
  if (!Object.keys(next).length) return { ok: false, errors: [{ id: changes[0]?.id ?? "rows", message: "Keep at least one field mapped." }] };
  const v = validateOutboundMap(kind, next);
  if (!v.ok) return { ok: false, errors: v.errors.map((e) => ({ id: e.field, message: e.message })) };
  return { ok: true, map: v.value };
}

// ── Inbound (what BPMSquare pulls) ──────────────────────────────────────────

export function invertInbound(map: Record<string, string>, standard: Record<string, string>, fields: readonly string[], known: readonly ErpFieldRef[]): MapRow[] {
  return fields.map((f) => ({
    id: f,
    bpm: { label: INBOUND_LABELS[f] ?? f, name: f },
    erp: map[f] ? withLabel(map[f], known) : null,
    standard: (map[f] ?? null) === (standard[f] ?? null),
  }));
}

export function applyInboundRows(
  fields: readonly string[], map: Record<string, string>, rows: { id: string; erp: string | null }[], known: readonly ErpFieldRef[],
): { ok: true; map: Record<string, string> } | { ok: false; errors: RowError[] } {
  const errors: RowError[] = [];
  const next = { ...map };
  const seen = new Set<string>();
  for (const r of rows) {
    if (typeof r?.id !== "string" || !fields.includes(r.id)) { errors.push({ id: String(r?.id), message: "This row is not part of the mapping." }); continue; }
    if (seen.has(r.id)) { errors.push({ id: r.id, message: "This row was sent twice." }); continue; }
    seen.add(r.id);
    const label = INBOUND_LABELS[r.id] ?? r.id;
    if (r.erp === null) { delete next[r.id]; continue; }
    if (typeof r.erp !== "string" || !PULL_FIELD_RE.test(r.erp.trim()) || r.erp.length > 120) { errors.push({ id: r.id, message: `${label}: that is not a valid ERP field name.` }); continue; }
    if (!knownErpField(r.erp.trim(), known)) { errors.push({ id: r.id, message: `${label}: ${r.erp.trim()} is not a field in the ERP.` }); continue; }
    next[r.id] = r.erp.trim();
  }
  if (errors.length) return { ok: false, errors };
  if (!Object.keys(next).length) return { ok: false, errors: [{ id: rows[0]?.id ?? "rows", message: "Keep at least one field mapped." }] };
  return { ok: true, map: next };
}

// ── The view ────────────────────────────────────────────────────────────────

/** Fields the engine always sets itself, so they are never reported as unmapped. */
export const ALWAYS_HEADER = ["name", "customerid", "pricelevelid", "transactioncurrencyid", "ownerid", "owningbusinessunit", "owninguser", "owningteam", "statecode", "statuscode"];
export const ALWAYS_LINES = ["quoteid", "salesorderid", "uomid", "isproductoverridden", "lineitemnumber", "ownerid", "owningbusinessunit", "owninguser", "owningteam"];

export type MappingInput = {
  doc: MappingDocKey;
  cfg: D365Config;
  /** The target the Quote document creates (resolved). */
  target: TargetKind;
  /** The ERP's own field lists (labels and technical names); empty when they could not be read. */
  erpFields: { header: ErpField[]; lines: ErpField[] };
};

const refOf = (f: ErpFieldRef): ErpFieldRef => ({ label: f.label, name: f.name });

export function buildMappingView(a: MappingInput): MappingView {
  const { cfg, doc } = a;
  const header = a.erpFields.header.filter((f) => f.creatable !== false);
  const lines = a.erpFields.lines.filter((f) => f.creatable !== false);
  const sections: MapSection[] = [];
  let usingStandard = true;
  let label = "Quote";
  let targetLabel = "";
  let settings: MappingView["settings"] = null;
  let missing: string[] = [];

  if (doc === "quote") {
    const k = quoteKinds(cfg.product, resolveTarget(cfg.product, a.target));
    targetLabel = `${PRODUCT_SHORT[cfg.product]} ${TARGET_LABEL[k.targetKey]}`;
    const hm = outboundMaps(cfg, k.header);
    sections.push({ key: "header", label: "Header data", rows: invertOutbound(hm.effective, hm.standard, placeholdersOf(k.header), labelsOf(k.header), header) });
    usingStandard = !hm.custom;
    missing = missingRequired(a.erpFields.header, Object.keys(hm.effective), ALWAYS_HEADER).map((f) => f.label);
    if (k.lines) {
      const lm = outboundMaps(cfg, k.lines);
      sections.push({ key: "lines", label: "Lines", rows: invertOutbound(lm.effective, lm.standard, placeholdersOf(k.lines), labelsOf(k.lines), lines) });
      usingStandard = usingStandard && !lm.custom;
      missing = [...missing, ...missingRequired(a.erpFields.lines, Object.keys(lm.effective), ALWAYS_LINES).map((f) => f.label)];
    }
    if (cfg.product !== "dataverse") {
      const eff = outboundConfig(cfg);
      const e = k.header === "sales_order" ? eff.sales_order : eff.project;
      settings = { entity_set: e.entity_set, id_field: e.id_field };
    }
  } else {
    label = INBOUND_LABEL_WORD[doc];
    targetLabel = `${PRODUCT_SHORT[cfg.product]} ${label}`;
    const key = doc as D365EntityKey;
    const ec = entityConfig(cfg, key);
    const std = D365_DEFAULTS[cfg.product]?.[key]?.field_map ?? {};
    const eff = ec?.field_map ?? {};
    sections.push({ key: "header", label: "Fields", rows: invertInbound(eff, std, INBOUND_FIELDS[doc], header) });
    usingStandard = JSON.stringify(sortKeys(eff)) === JSON.stringify(sortKeys(std));
  }

  const mapped = new Set<string>();
  for (const s of sections) for (const r of s.rows) if (r.erp) mapped.add(r.erp.name);
  const merge = (list: ErpFieldRef[], section: MapSection | undefined): ErpFieldRef[] => {
    const out = list.map(refOf);
    for (const r of section?.rows ?? []) if (r.erp && !out.some((f) => f.name === r.erp!.name)) out.push(refOf(r.erp));
    return out;
  };
  return {
    document: { key: doc, label, targetLabel },
    sections,
    erpFields: { header: merge(header, sections[0]), lines: merge(lines, sections[1]) },
    usingStandard,
    missingRequired: missing,
    settings,
  };
}

function sortKeys(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

// ── Save and reset: what changes in the connection's config ─────────────────

export type MappingChange = { outbound?: D365OutboundConfig | undefined; orders?: D365OrderConfig | undefined; entities?: D365Config["entities"] };
export type ApplyInput = MappingInput & {
  section: "header" | "lines";
  rows: { id: string; erp: string | null }[];
  settings?: { entity_set?: unknown; id_field?: unknown };
};

const SET_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function applyMapping(a: ApplyInput): { ok: true; change: MappingChange } | { ok: false; errors: RowError[] } {
  const { cfg, doc } = a;
  if (doc !== "quote") {
    if (a.section !== "header") return { ok: false, errors: [{ id: "section", message: "This mapping has one section." }] };
    const key = doc as D365EntityKey;
    const ec = entityConfig(cfg, key);
    const r = applyInboundRows(INBOUND_FIELDS[doc], ec?.field_map ?? {}, a.rows, a.erpFields.header);
    if (!r.ok) return r;
    return { ok: true, change: { entities: { ...cfg.entities, [key]: { ...(ec ?? { enabled: false, entity_set: "", id_field: "id" }), field_map: r.map } } } };
  }
  const k = quoteKinds(cfg.product, resolveTarget(cfg.product, a.target));
  const kind = a.section === "lines" ? k.lines : k.header;
  if (!kind) return { ok: false, errors: [{ id: "section", message: "This target has no lines section." }] };
  const m = outboundMaps(cfg, kind);
  const r = applyOutboundRows(kind, m.effective, a.rows, a.section === "lines" ? a.erpFields.lines : a.erpFields.header, labelsOf(kind));
  if (!r.ok) return r;
  const outbound: D365OutboundConfig = { ...(cfg.outbound ?? {}) };
  const orders: D365OrderConfig = { ...(cfg.orders ?? {}) };
  if (kind === "project") outbound.project = { ...(outbound.project ?? {}), field_map: r.map };
  else if (kind === "sales_order") orders.sales_order = { ...(orders.sales_order ?? {}), field_map: r.map };
  else if (kind === "sales_order_line") orders.sales_order_line = { field_map: r.map };
  else if (kind === "quote_line") outbound.quote_line = { field_map: r.map };
  else outbound.quote = { field_map: r.map };

  if (a.settings && (a.settings.entity_set !== undefined || a.settings.id_field !== undefined) && cfg.product !== "dataverse") {
    const es = a.settings.entity_set; const idf = a.settings.id_field;
    const errs: RowError[] = [];
    if (es !== undefined && !(typeof es === "string" && SET_RE.test(es.trim()))) errs.push({ id: "entity_set", message: "That is not a valid entity name." });
    if (idf !== undefined && !(typeof idf === "string" && SET_RE.test(idf.trim()))) errs.push({ id: "id_field", message: "That is not a valid field name." });
    if (errs.length) return { ok: false, errors: errs };
    const patch = { ...(es !== undefined ? { entity_set: String(es).trim() } : {}), ...(idf !== undefined ? { id_field: String(idf).trim() } : {}) };
    if (kind === "sales_order") orders.sales_order = { ...(orders.sales_order ?? {}), ...patch };
    else outbound.project = { ...(outbound.project ?? {}), ...patch };
  }
  return { ok: true, change: { outbound, orders } };
}

/** "Reset to standard": the document's own maps go back to the preset (the stored override is removed). */
export function resetMapping(cfg: D365Config, doc: MappingDocKey, target: TargetKind): MappingChange {
  if (doc !== "quote") {
    const key = doc as D365EntityKey;
    const own = cfg.entities?.[key];
    if (!own) return { entities: cfg.entities };
    // The stored entry keeps its other settings (switch, schedule, entity set); only its map goes back to the standard one.
    return { entities: { ...cfg.entities, [key]: { ...own, field_map: { ...(D365_DEFAULTS[cfg.product]?.[key]?.field_map ?? {}) } } } };
  }
  const k = quoteKinds(cfg.product, resolveTarget(cfg.product, target));
  const outbound: D365OutboundConfig = { ...(cfg.outbound ?? {}) };
  const orders: D365OrderConfig = { ...(cfg.orders ?? {}) };
  for (const kind of [k.header, k.lines]) {
    if (!kind) continue;
    if (kind === "project" && outbound.project) { const { field_map: _f, ...rest } = outbound.project; void _f; if (Object.keys(rest).length) outbound.project = rest; else delete outbound.project; }
    else if (kind === "sales_order" && orders.sales_order) { const { field_map: _f, ...rest } = orders.sales_order; void _f; if (Object.keys(rest).length) orders.sales_order = rest; else delete orders.sales_order; }
    else if (kind === "quote") delete outbound.quote;
    else if (kind === "quote_line") delete outbound.quote_line;
    else if (kind === "sales_order_line") delete orders.sales_order_line;
  }
  return { outbound: Object.keys(outbound).length ? outbound : undefined, orders: Object.keys(orders).length ? orders : undefined };
}
