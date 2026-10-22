import { applyConverter, isEmpty, reverseConverter, validateConverter, withDefault, type ListLookup } from "./convert";
import { typeCompat } from "./propose";
import type { Converter, FieldType, MapRow, MappingDocument, MappingProblem, Primitive, RowError, SourceField, TargetField } from "./types";

// The runtime (spec section 6): compile a mapping document once, run it against a record. Pure, no I/O. Problems are
// collected and never thrown; a row that has a problem is left out of the body, and the caller refuses the send.

export type CompiledRow = {
  id: string;
  target: string;
  source: string | null;
  convert: Converter | null;
  ifEmpty: string | null;
  required: boolean;
  missing: boolean;
  targetLabel: string;
  /** What the target stores: a text code that is a number to the target is sent as a number. */
  asNumber: boolean;
  asBoolean: boolean;
};

export type Program = {
  direction: "out" | "in";
  linesPath: string | null;
  header: CompiledRow[];
  lines: CompiledRow[];
  /** Every list kind a row goes through. */
  listKinds: string[];
};

export type CompileOptions = {
  direction: "out" | "in";
  sourceFields: { header: SourceField[]; lines: SourceField[] };
  lists: ListLookup;
  /** Judge the target path against the snapshot. Off when there is no snapshot to judge against. */
  checkTargets?: boolean;
};

const MAX_ROWS = 500;

const sourceTypeOf = (fields: SourceField[], key: string): FieldType | null => fields.find((f) => f.key === key)?.type ?? null;

/** A row is "set" when it sends something: a source, or a converter that needs none (a fixed value, a join). */
const isSet = (r: MapRow): boolean => r.source !== null || r.convert !== null;

function compileBlock(
  rows: MapRow[], block: "header" | "lines", schema: TargetField[], src: SourceField[], o: CompileOptions, errors: RowError[], kinds: Set<string>,
): CompiledRow[] {
  const out: CompiledRow[] = [];
  const seen = new Set<string>();
  const byPath = new Map(schema.map((f) => [f.path, f]));
  for (const r of rows) {
    if (!isSet(r)) continue;
    const err = (message: string) => errors.push({ rowId: r.id, field: r.target, message });
    if (typeof r.target !== "string" || !r.target || r.target.length > 160) { err("This row has no ERP field."); continue; }
    if (seen.has(r.target)) { err(`${r.target} is filled by two rows. Keep one.`); continue; }
    seen.add(r.target);
    const t = byPath.get(r.target);
    if (o.checkTargets !== false && schema.length && !t) { err(`${r.target} is not a field of the ERP${block === "lines" ? " lines" : ""}. Pick another field or remove the row.`); continue; }
    if (t && t.creatable === false && o.direction === "out") { err(`${t.label} cannot be set when a document is created. Pick another field or remove the row.`); continue; }

    let conv: Converter | null = null;
    if (r.convert !== null && r.convert !== undefined) {
      const v = validateConverter(r.convert, o.direction);
      if (!v.ok) { err(`${t?.label ?? r.target}: ${v.message}`); continue; }
      conv = v.value;
    }
    if (r.source !== null && !src.some((f) => f.key === r.source)) { err(`${t?.label ?? r.target}: ${r.source} is not a BPMSquare field${block === "lines" ? " of a line" : ""}.`); continue; }
    if (conv?.kind === "concat") {
      const unknown = conv.parts.find((p) => "field" in p && !src.some((f) => f.key === p.field)) as { field: string } | undefined;
      if (unknown) { err(`${t?.label ?? r.target}: ${unknown.field} is not a BPMSquare field.`); continue; }
    }
    if (conv?.kind === "value_list") {
      if (!o.lists(conv.list)) { err(`${t?.label ?? r.target}: the ${conv.list.replace(/^custom:/, "").replace(/_/g, " ")} list does not exist. Create it under Value mapping.`); continue; }
      kinds.add(conv.list);
    }
    if (r.ifEmpty !== null && (typeof r.ifEmpty !== "string" || r.ifEmpty.length > 500)) { err(`${t?.label ?? r.target}: the default is text of up to 500 characters.`); continue; }
    // A type that can never fit, even with a converter: an array, object or lookup against a plain value.
    const st = r.source ? sourceTypeOf(src, r.source) : null;
    if (t && st && conv === null && typeCompat(st, t.type).score === 0) {
      err(`${t.label} is a ${t.type} field and ${r.source} is ${st === "enum" ? "a choice" : st}: they do not fit. Pick another field.`);
      continue;
    }
    out.push({
      id: r.id, target: r.target, source: r.source, convert: conv, ifEmpty: r.ifEmpty ?? null,
      required: t?.required === true, missing: t?.state === "missing", targetLabel: t?.label ?? r.target,
      asNumber: !!t && (t.type === "integer" || t.type === "number" || (t.type === "enum" && !!t.enum?.length && t.enum.every((c) => /^-?\d+$/.test(c)))),
      asBoolean: t?.type === "boolean",
    });
  }
  return out;
}

export function compile(doc: Pick<MappingDocument, "header" | "lines" | "target">, o: CompileOptions): { ok: true; program: Program } | { ok: false; errors: RowError[] } {
  const errors: RowError[] = [];
  if (!Array.isArray(doc.header) || !Array.isArray(doc.lines)) return { ok: false, errors: [{ message: "The mapping has no rows." }] };
  if (doc.header.length > MAX_ROWS || doc.lines.length > MAX_ROWS) return { ok: false, errors: [{ message: `A mapping holds at most ${MAX_ROWS} rows per block.` }] };
  const ids = new Set<string>();
  for (const r of [...doc.header, ...doc.lines]) {
    if (typeof r?.id !== "string" || !r.id || ids.has(r.id)) errors.push({ rowId: typeof r?.id === "string" ? r.id : undefined, message: "Every row needs its own id." });
    else ids.add(r.id);
  }
  if (errors.length) return { ok: false, errors };
  const kinds = new Set<string>();
  const header = compileBlock(doc.header, "header", doc.target.schema.fields, o.sourceFields.header, o, errors, kinds);
  const lines = compileBlock(doc.lines, "lines", doc.target.schema.lineFields ?? [], o.sourceFields.lines, o, errors, kinds);
  if (doc.lines.some(isSet) && !doc.target.linesPath) errors.push({ message: "This mapping has lines but no lines block in the target. Choose where the lines go." });
  if (errors.length) return { ok: false, errors };
  return { ok: true, program: { direction: o.direction, linesPath: doc.target.linesPath, header, lines, listKinds: [...kinds].sort() } };
}

// ── Run ──────────────────────────────────────────────────────────────────────

export type SourceRecord = {
  header: Record<string, Primitive | undefined>;
  lines: Record<string, Primitive | undefined>[];
};

export type RunOptions = {
  lists: ListLookup;
  /** Target paths the engine itself fills whatever the mapping says: never a required_empty problem. */
  engineSets?: readonly string[];
};

export type RunResult = { header: Record<string, unknown>; lines: Record<string, unknown>[]; problems: MappingProblem[] };

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

/** Put `value` at `path`. A name with an `@` (a Dataverse bind) is one flat key; otherwise a dotted path nests. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): boolean {
  const flat = path.includes("@") || !path.includes(".");
  const segs = flat ? [path] : path.split(".");
  if (segs.some((s) => s === "" || UNSAFE.has(s))) return false;
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const next = Object.prototype.hasOwnProperty.call(cur, segs[i]) ? cur[segs[i]] : undefined;
    if (next === undefined) { const fresh: Record<string, unknown> = {}; cur[segs[i]] = fresh; cur = fresh; }
    else if (next && typeof next === "object" && !Array.isArray(next)) cur = next as Record<string, unknown>;
    else return false;
  }
  cur[segs[segs.length - 1]] = value;
  return true;
}

/** A list code is text, but a Dataverse choice or a number column takes a number, and a yes/no column a boolean. */
function coerce(v: Primitive, r: CompiledRow): Primitive {
  if (typeof v !== "string") return v;
  if (r.asNumber && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  if (r.asBoolean && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === "true";
  return v;
}

function runBlock(rows: CompiledRow[], record: Record<string, Primitive | undefined>, o: RunOptions, problems: MappingProblem[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const always = new Set((o.engineSets ?? []).map((p) => p.toLowerCase()));
  for (const r of rows) {
    if (r.missing) {
      problems.push({ code: "target_field_missing", rowId: r.id, field: r.target, message: `${r.targetLabel} is no longer in the target.`, fix: "Pick another field or remove the row in Mapping, then Restart." });
      continue;
    }
    const raw = r.source ? record[r.source] : undefined;
    let v: Primitive | undefined = raw;
    if (r.convert) {
      const a = applyConverter(r.convert, raw, { record, lists: o.lists, rowId: r.id, field: r.target, source: r.source ?? undefined });
      if (!a.ok) { problems.push(a.problem); continue; }
      v = a.value;
    }
    const final = withDefault(v, r.ifEmpty);
    if (isEmpty(final)) {
      if (r.required && !always.has(r.target.toLowerCase()) && !always.has(r.target.replace(/@odata\.bind$/i, "").toLowerCase())) {
        problems.push({
          code: "required_empty", rowId: r.id, field: r.target,
          message: `${r.targetLabel} is required by the target and ${r.source ?? "its source"} is empty.`,
          fix: "Fill it on the record, or set a default for the row in Mapping, then Restart.",
        });
      }
      continue;
    }
    if (!setPath(out, r.target, coerce(final, r))) problems.push({ code: "row_invalid", rowId: r.id, field: r.target, message: `${r.targetLabel} cannot be written.`, fix: "Pick another field in Mapping." });
  }
  return out;
}

export function run(program: Program, record: SourceRecord, o: RunOptions): RunResult {
  const problems: MappingProblem[] = [];
  const header = runBlock(program.header, record.header, o, problems);
  const lines = program.lines.length || record.lines.length ? record.lines.map((l) => runBlock(program.lines, l, o, problems)) : [];
  return { header, lines, problems: dedupeProblems(problems) };
}

/** One problem per distinct fault: ten lines in Box are one "Unit 'Box' has no ERP code", not ten. */
export function dedupeProblems(problems: MappingProblem[]): MappingProblem[] {
  const seen = new Set<string>();
  const out: MappingProblem[] = [];
  for (const p of problems) {
    const key = p.code === "value_unmapped" ? `${p.code}|${p.list}|${p.value}` : `${p.code}|${p.rowId ?? ""}|${p.field ?? ""}|${p.value ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** The body a webhook or an ERP gets: the header, with the lines under the target's lines path. */
export function assembleBody(program: Program, r: Pick<RunResult, "header" | "lines">): Record<string, unknown> {
  const body: Record<string, unknown> = { ...r.header };
  if (program.linesPath && r.lines.length && !UNSAFE.has(program.linesPath)) body[program.linesPath] = r.lines;
  return body;
}

/**
 * Problems as a Monitor row reads them. Several unmapped values of one list become one sentence ("Unit 'Mtr', 'Box' have no
 * ERP code."), and the first problem's fix leads. `kind` is what `classifyIntegrationRow` files the row under.
 */
export function describeProblems(problems: MappingProblem[]): { headline: string; fix: string; kind: "mapping_value" | "mapping_invalid"; codes: string[] } {
  const values = problems.filter((p) => p.code === "value_unmapped");
  const others = problems.filter((p) => p.code !== "value_unmapped");
  const lists = new Map<string, { label: string; values: string[] }>();
  for (const p of values) {
    const label = (p.message.match(/^(.*?) '/)?.[1]) ?? (p.list ?? "Value");
    const e = lists.get(p.list ?? label) ?? { label, values: [] };
    if (p.value && !e.values.includes(p.value)) e.values.push(p.value);
    lists.set(p.list ?? label, e);
  }
  const sentences = [...lists.values()].map((l) => `${l.label} ${l.values.map((v) => `'${v}'`).join(", ")} ${l.values.length === 1 ? "has" : "have"} no ERP code.`);
  if (values.length) {
    const more = others.length ? ` ${others[0].message}` : "";
    return { headline: `${sentences.join(" ")}${more}`.trim(), fix: values[0].fix, kind: "mapping_value", codes: problems.map((p) => p.code) };
  }
  const first = others[0];
  return { headline: first?.message ?? "The mapping could not be applied.", fix: first?.fix ?? "Open Mapping, then Restart.", kind: "mapping_invalid", codes: problems.map((p) => p.code) };
}

// ── Inbound ──────────────────────────────────────────────────────────────────

export type InboundResult = {
  values: Record<string, Primitive>;
  unknown: { list: string; value: string }[];
  bad: string[];
};

function readPath(row: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, path)) return row[path];
  let cur: unknown = row;
  for (const part of path.split(".")) {
    if (UNSAFE.has(part) || cur === null || typeof cur !== "object") return undefined;
    cur = Object.prototype.hasOwnProperty.call(cur, part) ? (cur as Record<string, unknown>)[part] : undefined;
  }
  return cur;
}

/** One ERP row into BPMSquare field values through the inbound rows (reverse converters). Never fails: an unknown code is kept raw and listed. */
export function runInbound(program: Program, erpRow: Record<string, unknown>, lists: ListLookup): InboundResult {
  const values: Record<string, Primitive> = {};
  const unknown: InboundResult["unknown"] = [];
  const bad: string[] = [];
  for (const r of program.header) {
    if (!r.source) continue;
    const raw = readPath(erpRow, r.target);
    const rev = reverseConverter(r.convert, raw, lists);
    if (rev.unknown) unknown.push(rev.unknown);
    if (rev.bad) bad.push(r.target);
    const final = withDefault(rev.value, r.ifEmpty);
    values[r.source] = isEmpty(final) ? null : final;
  }
  return { values, unknown, bad };
}

/** The `field_map` the older pull reads (`BPM field = ERP field`) for the same inbound rows, so $select and the id logic stay as they are. */
export function inboundFieldMap(program: Program): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of program.header) if (r.source) out[r.source] = r.target;
  return out;
}
