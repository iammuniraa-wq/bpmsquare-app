import { applyConverter, validateConverter } from "@/lib/middleware/mapping/convert";
import { kindLabel } from "@/lib/middleware/mapping/valueLists";
import {
  STANDARD_LIST_KINDS, type Converter, type MapRow, type SourceField, type TargetField, type ValueList,
} from "@/lib/middleware/mapping/types";
import type { AiSuggestion, EngineData, EngineRows, ErrorItem, MappingDocView } from "./api";

// The Mapping tab's pure parts (Fields view). A row is one BPMSquare field and the target field it fills. The person
// only ever changes the target side and its converter; the screen keeps the whole row set as a working copy until Save.

export type Block = "header" | "lines";
export const BLOCKS: readonly Block[] = ["header", "lines"];
export const NOT_SENT = "";

/** What the screen draws: one line per BPMSquare field (mapped or not), plus the rows that read no single field. */
export type ViewRow = {
  key: string;
  rowId: string | null;
  source: string | null;
  label: string;
  tech: string;
  target: string | null;
  convert: Converter | null;
  ifEmpty: string | null;
  origin: MapRow["origin"];
  confidence: MapRow["confidence"];
};

const cloneRows = (r: EngineRows): EngineRows => JSON.parse(JSON.stringify(r)) as EngineRows;
export const copyRows = cloneRows;

/** A short words-only description of a row that reads no single field: a join, a fixed value. */
export function describeSource(conv: Converter | null, fields: readonly SourceField[]): string {
  if (conv?.kind === "concat") {
    const names = conv.parts.flatMap((p) => ("field" in p ? [fields.find((f) => f.key === p.field)?.label ?? p.field] : []));
    return names.length ? names.join(", ") : "Joined text";
  }
  if (conv?.kind === "constant") return `Fixed value${String(conv.value) === "" ? "" : `: ${String(conv.value)}`}`;
  return "Fixed value";
}

export function viewRows(rows: readonly MapRow[], fields: readonly SourceField[]): ViewRow[] {
  const known = new Set(fields.map((f) => f.key));
  const mk = (r: MapRow, label: string, tech: string): ViewRow => ({
    key: r.id, rowId: r.id, source: r.source, label, tech, target: r.target || null, convert: r.convert, ifEmpty: r.ifEmpty, origin: r.origin, confidence: r.confidence,
  });
  const out: ViewRow[] = [];
  for (const r of rows) if (r.source === null) out.push(mk(r, describeSource(r.convert, fields), ""));
  for (const f of fields) {
    const mine = rows.filter((r) => r.source === f.key);
    if (mine.length === 0) {
      out.push({ key: `src:${f.key}`, rowId: null, source: f.key, label: f.label, tech: f.key, target: null, convert: null, ifEmpty: null, origin: "user", confidence: null });
    } else for (const r of mine) out.push(mk(r, f.label, f.key));
  }
  for (const r of rows) if (r.source !== null && !known.has(r.source)) out.push(mk(r, r.source, r.source));
  return out;
}

const touched = (r: MapRow): MapRow => ({ ...r, origin: "user", confidence: null });

/** Choose (or clear) the target of a line. A BPMSquare field with no row yet gets one. */
export function setRowTarget(rows: readonly MapRow[], v: ViewRow, target: string | null, newId: () => string): MapRow[] {
  if (v.rowId === null) {
    if (!target) return [...rows];
    return [...rows, { id: newId(), target, source: v.source, convert: null, ifEmpty: null, origin: "user", confidence: null }];
  }
  if (!target && v.source !== null) return rows.filter((r) => r.id !== v.rowId);
  return rows.map((r) => (r.id === v.rowId ? { ...touched(r), target: target ?? "" } : r));
}

export function setRowConvert(rows: readonly MapRow[], rowId: string, convert: Converter | null, ifEmpty: string | null): MapRow[] {
  return rows.map((r) => (r.id === rowId ? { ...touched(r), convert, ifEmpty: ifEmpty && ifEmpty.trim() ? ifEmpty : null } : r));
}

export const acceptRow = (rows: readonly MapRow[], rowId: string): MapRow[] => rows.map((r) => (r.id === rowId ? touched(r) : r));
export const removeRow = (rows: readonly MapRow[], rowId: string): MapRow[] => rows.filter((r) => r.id !== rowId);

/** A fixed-value row to fill in: its target is chosen next. */
export const blankRow = (id: string): MapRow => ({ id, target: "", source: null, convert: { kind: "constant", value: "" }, ifEmpty: null, origin: "user", confidence: null });

/** What is sent on Save: a row with no target yet is not a row. */
export const cleanRows = (r: EngineRows): EngineRows => ({ header: r.header.filter((x) => x.target.trim()), lines: r.lines.filter((x) => x.target.trim()) });

export const sameRows = (a: EngineRows, b: EngineRows): boolean => JSON.stringify(cleanRows(a)) === JSON.stringify(cleanRows(b));
export const isMapDirty = (base: EngineRows | null, now: EngineRows | null): boolean => !!base && !!now && !sameRows(base, now);

/** Rows added by the AI review: every accepted line, marked "ai". The converter is the type gate's, never the model's. */
export function addSuggestions(rows: EngineRows, accepted: readonly AiSuggestion[], newId: () => string): EngineRows {
  const out = cloneRows(rows);
  for (const sg of accepted) {
    const block = sg.block === "lines" ? out.lines : out.header;
    if (block.some((r) => r.target === sg.target)) continue;
    block.push({ id: newId(), target: sg.target, source: sg.source, convert: sg.convert, ifEmpty: null, origin: "ai", confidence: null });
  }
  return out;
}

// ── Words ───────────────────────────────────────────────────────────────────

export function confidenceWord(r: Pick<MapRow, "origin" | "confidence">): string | null {
  if (r.origin === "ai") return "AI";
  if (r.origin === "proposed" && r.confidence) return { sure: "Sure", likely: "Likely", guess: "Guess" }[r.confidence];
  return null;
}
/** A row the person has not looked at yet: Accept keeps it as it is. */
export const needsAccept = (r: Pick<MapRow, "origin">): boolean => r.origin === "proposed" || r.origin === "ai";

export function convertLabel(c: Converter | null): string {
  if (!c) return "–";
  switch (c.kind) {
    case "value_list": return `${kindLabel(c.list)} list`;
    case "constant": return "Fixed value";
    case "concat": return "Join";
    case "split": return "Split";
    case "date": return `Date ${c.format}`;
    case "number": return c.asText ? "Number as text" : "Number";
    case "text": return { trim: "Trim", upper: "Upper case", lower: "Lower case", truncate: "Shorten" }[c.op];
    case "boolean": return "Yes/No";
  }
}

export const CONVERT_CHOICES: { kind: Converter["kind"]; label: string }[] = [
  { kind: "value_list", label: "Value list" }, { kind: "date", label: "Date format" }, { kind: "number", label: "Number" },
  { kind: "text", label: "Text" }, { kind: "boolean", label: "Yes/No" }, { kind: "concat", label: "Join fields" },
  { kind: "split", label: "Split text" }, { kind: "constant", label: "Fixed value" },
];
/** Converters that cannot be read back, so an inbound row never offers them. */
export const outboundOnly = (kind: Converter["kind"]): boolean => kind === "constant" || kind === "concat" || kind === "split";

/** The default converter a kind starts from in the sheet. */
export function startConverter(kind: Converter["kind"], listKind: string): Converter {
  switch (kind) {
    case "value_list": return { kind, list: listKind };
    case "constant": return { kind, value: "" };
    case "concat": return { kind, parts: [{ text: "" }] };
    case "split": return { kind, sep: "-", index: 0 };
    case "date": return { kind, format: "iso-date" };
    case "number": return { kind, decimals: 2 };
    case "text": return { kind, op: "trim" };
    case "boolean": return { kind, trueValue: "true", falseValue: "false" };
  }
}

/** The lists a "Value list" converter can point at: the connection's, the proposed ones, and the standard kinds. */
export function listChoices(existing: readonly string[], proposed: readonly string[]): { kind: string; label: string }[] {
  const kinds = [...new Set([...STANDARD_LIST_KINDS, ...existing, ...proposed])];
  return kinds.map((k) => ({ kind: k, label: kindLabel(k) }));
}

export const checkConverter = (c: Converter, direction: "out" | "in"): string | null => {
  const v = validateConverter(c, direction);
  return v.ok ? null : v.message;
};

const SAMPLE: Record<string, string | number | boolean> = { text: "SQ-0012", integer: 3, number: 12.5, boolean: true, date: "2026-10-21", datetime: "2026-10-21T10:00:00Z" };

/** "Mtr → M": the converter applied to a sample, so the person sees what it does. Null when there is nothing to show. */
export function converterExample(conv: Converter, source: SourceField | null, list: ValueList | undefined): string | null {
  let value: string | number | boolean | null = source ? SAMPLE[source.type] ?? "Sample" : null;
  if (conv.kind === "value_list") value = list?.rows.find((r) => r.bpm)?.bpm ?? null;
  if (conv.kind === "split") value = "SQ-0012";
  if (conv.kind === "text") value = "  Fence ";
  const record: Record<string, string | number | boolean | null> = {};
  if (conv.kind === "concat") for (const p of conv.parts) if ("field" in p) record[p.field] = `<${p.field}>`;
  const r = applyConverter(conv, value, { record, lists: (k) => (list && list.kind === k ? list : undefined) });
  if (!r.ok) return r.problem.message;
  if (r.value === null || r.value === "") return null;
  return conv.kind === "value_list" || conv.kind === "text" || conv.kind === "split" || conv.kind === "date" || conv.kind === "number" || conv.kind === "boolean"
    ? `${String(value)} → ${String(r.value)}` : String(r.value);
}

// ── Checks and bars ─────────────────────────────────────────────────────────

/** The one bar the tab may show. Empty when nothing is missing. */
export function missingBar(missing: readonly string[]): string | null {
  if (missing.length === 0) return null;
  return `The ERP needs ${missing.join(", ")} and nothing fills ${missing.length === 1 ? "it" : "them"} yet. Pick a field below, or reset to standard.`;
}

/** The server's missing list as of the last load, minus what the person has since mapped. */
export function stillMissing(labels: readonly string[], fields: readonly TargetField[], rows: readonly MapRow[]): string[] {
  const filled = new Set(rows.filter((r) => r.target && (r.source !== null || r.convert !== null)).map((r) => r.target.toLowerCase().replace(/@odata\.bind$/, "")));
  return labels.filter((label) => {
    const hits = fields.filter((f) => f.label === label);
    if (hits.length === 0) return true;
    return !hits.some((f) => {
      const p = f.path.toLowerCase().replace(/@odata\.bind$/, "");
      return [...filled].some((x) => x === p || x.startsWith(`${p}_`));
    });
  });
}

/** Row messages from a refused save, by row id; the ones with no row are returned as `general`. */
export function errorsByRow(errors: readonly ErrorItem[]): { byRow: Record<string, string>; general: string[] } {
  const byRow: Record<string, string> = {};
  const general: string[] = [];
  for (const e of errors) {
    if (e.rowId) byRow[e.rowId] ||= e.message;
    else general.push(e.message);
  }
  return { byRow, general };
}

/** "112 fields · fetched today 14:02", for the bar under the title. */
export function fetchedWord(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `today ${hm}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `yesterday ${hm}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export type BarLine = { count: string; fetched: string | null; fresh: number; gone: number };
export function schemaBar(target: EngineData["target"], counts: { total: number; new: number; missing: number }, now?: Date): BarLine {
  return {
    count: counts.total === 0 ? "No field list yet" : `${counts.total} field${counts.total === 1 ? "" : "s"}`,
    fetched: target.kind === "adapter" ? null : fetchedWord(target.schema.fetchedAt, now),
    fresh: counts.new, gone: counts.missing,
  };
}

/** A fetched list never replaces mapped rows silently: say how a changed list differs. */
export const changeChips = (b: Pick<BarLine, "fresh" | "gone">): string[] => [
  ...(b.fresh ? [`${b.fresh} new`] : []), ...(b.gone ? [`${b.gone} missing`] : []),
];

export const tryBlocker = (dirty: boolean, noMapping: boolean): string | null =>
  dirty ? "Save the mapping first: Try it shows the saved one." : noMapping ? "No fields to try yet." : null;

/** Plain words for a refused AI call (402 over budget, 403 flag off, 503 not set up). */
export function aiProblemWords(status: number, fallback: string): string {
  if (status === 402) return "This month's AI allowance is used up. It starts again next month.";
  if (status === 403) return "The AI assistant is not switched on for this workspace.";
  if (status === 503) return "AI is not set up for this workspace yet.";
  return fallback;
}

// ── The selector ────────────────────────────────────────────────────────────

export type MapChoice = { key: string; label: string; document: string; connection: string };

/** The document and where it lands, the inbound entities, then each Call webhook that takes a quote. */
export function documentChoices(system: string, quoteTarget: string | null, connection = "dynamics365", webhooks: readonly { id: string; name: string }[] = []): MapChoice[] {
  return [
    { key: "quote", label: quoteTarget ? `Quote → ${system} ${quoteTarget}` : "Quote", document: "quote", connection },
    { key: "customers", label: `Customers (from ${system})`, document: "customers", connection },
    { key: "contacts", label: `Contacts (from ${system})`, document: "contacts", connection },
    { key: "products", label: `Products (from ${system})`, document: "products", connection },
    { key: "projects", label: `Projects (from ${system})`, document: "projects", connection },
    ...webhooks.map((w) => ({ key: `webhook:${w.id}`, label: `Quote → ${w.name} (webhook)`, document: "quote", connection: `webhook:${w.id}` })),
  ];
}

export const INBOUND_DOCUMENTS = ["customers", "contacts", "products", "projects"] as const;
export const isInboundDocument = (key: string): boolean => (INBOUND_DOCUMENTS as readonly string[]).includes(key);
export const isWebhookConnection = (c: string): boolean => c.startsWith("webhook:");

/** The field map the sample-data preview reads: BPMSquare field -> ERP column, for the rows that have one. */
export function sampleFieldMap(rows: EngineRows): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows.header) if (r.source && r.target) out[r.source] = r.target;
  return out;
}

// ── While the database update is pending ────────────────────────────────────

/** The older per-section edits for plain field changes, for a view that came with the update still pending. */
export function legacyEdits(view: MappingDocView, rows: EngineRows): { section: Block; rows: { id: string; erp: string | null }[] }[] {
  const out: { section: Block; rows: { id: string; erp: string | null }[] }[] = [];
  for (const sec of view.sections) {
    if (sec.key !== "header" && sec.key !== "lines") continue;
    const mine = rows[sec.key];
    const editable = sec.rows.filter((r) => !(r.standard && r.composite));
    const next = editable.map((r) => ({ id: r.id, erp: mine.find((x) => x.source === r.bpm.name)?.target || null }));
    if (editable.some((r, i) => (r.erp?.name ?? null) !== next[i].erp)) out.push({ section: sec.key, rows: next });
  }
  return out;
}

/** Whether the change is only "this field goes to that field": the one kind of change the older save can carry. */
export function onlyPlainChanges(base: EngineRows, now: EngineRows): boolean {
  const plain = (r: MapRow) => r.source !== null && r.convert === null && r.ifEmpty === null;
  const ids = (rows: MapRow[]) => new Map(rows.map((r) => [r.id, JSON.stringify(r)]));
  for (const b of BLOCKS) {
    const old = ids(base[b]);
    for (const r of now[b]) if (old.get(r.id) !== JSON.stringify(r) && !plain(r)) return false;
    for (const r of base[b]) if (!now[b].some((x) => x.id === r.id) && !plain(r)) return false;
  }
  return true;
}

// ── The webhook's body, as a template ───────────────────────────────────────

function setDeep(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  let cur = obj;
  parts.forEach((p, i) => {
    if (["__proto__", "constructor", "prototype"].includes(p)) return;
    if (i === parts.length - 1) cur[p] = value;
    else cur = (cur[p] && typeof cur[p] === "object" ? cur[p] : (cur[p] = {})) as Record<string, unknown>;
  });
}

const tokenFor = (r: MapRow): unknown => {
  if (r.convert?.kind === "constant") return r.convert.value;
  if (r.convert?.kind === "concat") return r.convert.parts.map((p) => ("field" in p ? `{{${p.field}}}` : p.text)).join("");
  return r.source ? `{{${r.source}}}` : "";
};

/** The body a mapping builds, with `{{field}}` where each value goes. Derived on read, never stored. */
export function generatedTemplate(rows: EngineRows, linesPath: string | null): string {
  const body: Record<string, unknown> = {};
  for (const r of rows.header) if (r.target) setDeep(body, r.target, tokenFor(r));
  if (linesPath && rows.lines.length) {
    const line: Record<string, unknown> = {};
    for (const r of rows.lines) if (r.target) setDeep(line, r.target, tokenFor(r));
    body[linesPath] = [line];
  }
  return JSON.stringify(body, null, 2);
}

/** Every list kind a "Value list" converter in these rows points at. */
export function usedListKinds(rows: EngineRows): string[] {
  const kinds = new Set<string>();
  for (const r of [...rows.header, ...rows.lines]) if (r.target.trim() && r.convert?.kind === "value_list") kinds.add(r.convert.list);
  return [...kinds];
}

// ── Adding fields by hand ───────────────────────────────────────────────────

/** One field per line: `name`, `name type`, `name type*` (required). A line starting `<lines>.` belongs to the lines block. */
export function parseManualText(text: string, linesPath: string): { fields: { path: string; type: string; required?: boolean; block?: "lines" }[]; problem: string | null } {
  const fields: { path: string; type: string; required?: boolean; block?: "lines" }[] = [];
  const lp = linesPath.trim();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_.@]*)(?:\s+([a-z]+))?(\*)?$/.exec(line.replace(/\s*\*$/, "*"));
    if (!m) return { fields, problem: `"${line.slice(0, 40)}": write a field name, then its type, such as: city text` };
    let path = m[1];
    let block: "lines" | undefined;
    if (lp && path.startsWith(`${lp}.`)) { path = path.slice(lp.length + 1); block = "lines"; }
    fields.push({ path, type: m[2] ?? "text", ...(m[3] ? { required: true } : {}), ...(block ? { block } : {}) });
  }
  return { fields, problem: fields.length ? null : "Add at least one field." };
}
