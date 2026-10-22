import {
  CONVERTER_KINDS, DATE_FORMATS,
  type ConcatPart, type Converter, type DateFormat, type MappingProblem, type Primitive, type ValueList,
} from "./types";

// The closed set of row converters (spec section 4). Data, never code: no eval, no template language, no
// regex built from tenant input (`split.sep` is a literal). Pure. A ninth kind is a product change.

export const MAX_CONCAT_PARTS = 6;
const MAX_TEXT = 200;
const MAX_CONSTANT = 2000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const isEmpty = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Kinds that cannot be read back: refused on an inbound row. */
export const OUTBOUND_ONLY: readonly Converter["kind"][] = ["constant", "concat", "split"];

type Check = { ok: true; value: Converter } | { ok: false; message: string };
const bad = (message: string): Check => ({ ok: false, message });

const scalar = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/** A converter as received from a client: unknown kinds, extra keys and out-of-range values are refused, never coerced. */
export function validateConverter(raw: unknown, direction: "out" | "in" = "out"): Check {
  if (!isObj(raw)) return bad("The converter must be an object.");
  const kind = raw.kind;
  if (typeof kind !== "string" || !(CONVERTER_KINDS as readonly string[]).includes(kind)) return bad(`"${String(kind).slice(0, 30)}" is not a converter BPMSquare offers.`);
  const allowedKeys: Record<string, string[]> = {
    value_list: ["kind", "list"], constant: ["kind", "value"], concat: ["kind", "parts", "skipEmpty", "requireAll"], split: ["kind", "sep", "index"],
    date: ["kind", "format"], number: ["kind", "scale", "decimals", "asText"], text: ["kind", "op", "max"], boolean: ["kind", "trueValue", "falseValue"],
  };
  for (const k of Object.keys(raw)) if (!allowedKeys[kind].includes(k)) return bad(`The ${kind} converter has no setting called "${k.slice(0, 30)}".`);
  if (direction === "in" && (OUTBOUND_ONLY as readonly string[]).includes(kind)) return bad(`A ${kind} cannot be read back from the ERP. Use it on a field BPMSquare sends, not one it receives.`);

  switch (kind) {
    case "value_list": {
      if (typeof raw.list !== "string" || !/^(unit|currency|country|payment_terms|incoterms|status|custom:[a-z0-9_]{1,40})$/.test(raw.list)) return bad("Choose a value list.");
      return { ok: true, value: { kind, list: raw.list } };
    }
    case "constant": {
      if (!scalar(raw.value) || (typeof raw.value === "string" && raw.value.length > MAX_CONSTANT)) return bad("A fixed value is text, a number or yes/no.");
      return { ok: true, value: { kind, value: raw.value } };
    }
    case "concat": {
      if (!Array.isArray(raw.parts) || raw.parts.length === 0 || raw.parts.length > MAX_CONCAT_PARTS) return bad(`Join between 1 and ${MAX_CONCAT_PARTS} parts.`);
      const parts: ConcatPart[] = [];
      for (const p of raw.parts) {
        if (!isObj(p)) return bad("Each part is a field or some text.");
        if (typeof p.field === "string" && Object.keys(p).length === 1 && /^[A-Za-z_][A-Za-z0-9_.]{0,60}$/.test(p.field)) parts.push({ field: p.field });
        else if (typeof p.text === "string" && Object.keys(p).length === 1 && p.text.length <= 40) parts.push({ text: p.text });
        else return bad("Each part is a field or some text of at most 40 characters.");
      }
      if (raw.skipEmpty !== undefined && typeof raw.skipEmpty !== "boolean") return bad("Skip empty is on or off.");
      if (raw.requireAll !== undefined && typeof raw.requireAll !== "boolean") return bad("Leave out when any part is empty is on or off.");
      if (raw.skipEmpty === true && raw.requireAll === true) return bad("Skip empty and Leave out when any part is empty cannot both be on.");
      return { ok: true, value: { kind, parts, ...(raw.skipEmpty === true ? { skipEmpty: true } : {}), ...(raw.requireAll === true ? { requireAll: true } : {}) } };
    }
    case "split": {
      if (typeof raw.sep !== "string" || raw.sep.length < 1 || raw.sep.length > 10) return bad("Give the separator, 1 to 10 characters.");
      if (typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < -1 || raw.index > 50) return bad("The part number is 0 for the first, up to 50, or -1 for the last.");
      return { ok: true, value: { kind, sep: raw.sep, index: raw.index } };
    }
    case "date": {
      if (!(DATE_FORMATS as readonly unknown[]).includes(raw.format)) return bad(`Choose a date format: ${DATE_FORMATS.join(", ")}.`);
      return { ok: true, value: { kind, format: raw.format as DateFormat } };
    }
    case "number": {
      const out: Extract<Converter, { kind: "number" }> = { kind };
      if (raw.scale !== undefined) {
        if (typeof raw.scale !== "number" || !Number.isFinite(raw.scale) || raw.scale === 0 || Math.abs(raw.scale) > 1e9) return bad("The scale is a number other than 0, e.g. 100.");
        out.scale = raw.scale;
      }
      if (raw.decimals !== undefined) {
        if (typeof raw.decimals !== "number" || !Number.isInteger(raw.decimals) || raw.decimals < 0 || raw.decimals > 6) return bad("Decimals are 0 to 6.");
        out.decimals = raw.decimals;
      }
      if (raw.asText !== undefined) {
        if (typeof raw.asText !== "boolean") return bad("Send as text is on or off.");
        if (raw.asText) out.asText = true;
      }
      return { ok: true, value: out };
    }
    case "text": {
      if (!["trim", "upper", "lower", "truncate"].includes(String(raw.op))) return bad("Choose trim, upper, lower or truncate.");
      if (raw.op === "truncate") {
        if (typeof raw.max !== "number" || !Number.isInteger(raw.max) || raw.max < 1 || raw.max > 5000) return bad("Truncate needs a length from 1 to 5000.");
        return { ok: true, value: { kind, op: "truncate", max: raw.max } };
      }
      if (raw.max !== undefined) return bad("Only truncate takes a length.");
      return { ok: true, value: { kind, op: raw.op as "trim" | "upper" | "lower" } };
    }
    case "boolean": {
      if (!scalar(raw.trueValue) || !scalar(raw.falseValue)) return bad("Give the value for yes and for no.");
      if (String(raw.trueValue).length > MAX_TEXT || String(raw.falseValue).length > MAX_TEXT) return bad("Those values are too long.");
      return { ok: true, value: { kind, trueValue: raw.trueValue, falseValue: raw.falseValue } };
    }
  }
  return bad("Unknown converter.");
}

// ── Dates ────────────────────────────────────────────────────────────────────

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function validYmd(y: number, m: number, d: number): boolean {
  if (!(y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1)) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

type Parsed = { y: number; m: number; d: number; ms: number };

/** An ISO date or datetime, a dd.MM.yyyy / dd/MM/yyyy / MM/dd/yyyy / yyyyMMdd date, or epoch milliseconds. */
export function parseDateValue(v: unknown): Parsed | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const dt = new Date(v);
    return Number.isNaN(dt.getTime()) ? null : { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), ms: v };
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validYmd(y, mo, d)) return null;
    const ms = Date.parse(m[4] ? s.replace(" ", "T") : `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return { y, m: mo, d, ms: Number.isNaN(ms) ? Date.UTC(y, mo - 1, d) : ms };
  }
  m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s) ?? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) {
    // dd.MM.yyyy and dd/MM/yyyy read day first; a slash date that cannot be day first is read month first.
    const dayFirst = s.includes(".") || Number(m[2]) <= 12;
    const [d, mo] = dayFirst ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
    const y = Number(m[3]);
    return validYmd(y, mo, d) ? { y, m: mo, d, ms: Date.UTC(y, mo - 1, d) } : null;
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYmd(y, mo, d) ? { y, m: mo, d, ms: Date.UTC(y, mo - 1, d) } : null;
  }
  return null;
}

export function formatDate(p: Parsed, format: DateFormat): string | number {
  switch (format) {
    case "iso-date": return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
    case "iso-datetime": return new Date(p.ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    case "dd.MM.yyyy": return `${pad(p.d)}.${pad(p.m)}.${pad(p.y, 4)}`;
    case "dd/MM/yyyy": return `${pad(p.d)}/${pad(p.m)}/${pad(p.y, 4)}`;
    case "MM/dd/yyyy": return `${pad(p.m)}/${pad(p.d)}/${pad(p.y, 4)}`;
    case "yyyyMMdd": return `${pad(p.y, 4)}${pad(p.m)}${pad(p.d)}`;
    case "epoch-ms": return p.ms;
  }
}

/** Parse a string written in exactly `format` back to ISO (the inbound direction). */
function parseFormatted(v: unknown, format: DateFormat): string | null {
  if (format === "epoch-ms") {
    const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
    const p = parseDateValue(n);
    return p ? new Date(p.ms).toISOString() : null;
  }
  const s = typeof v === "string" ? v.trim() : "";
  let m: RegExpExecArray | null = null;
  let y = 0, mo = 0, d = 0;
  if (format === "dd.MM.yyyy") { m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s); if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]; }
  else if (format === "dd/MM/yyyy") { m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]; }
  else if (format === "MM/dd/yyyy") { m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if (m) [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])]; }
  else if (format === "yyyyMMdd") { m = /^(\d{4})(\d{2})(\d{2})$/.exec(s); if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]; }
  else {
    const p = parseDateValue(s);
    if (!p) return null;
    return format === "iso-date" ? `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}` : new Date(p.ms).toISOString();
  }
  if (!m || !validYmd(y, mo, d)) return null;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
}

// ── Apply ────────────────────────────────────────────────────────────────────

export type ListLookup = (kind: string) => ValueList | undefined;

export type ApplyCtx = {
  /** The record the row reads: the header block or one line. */
  record: Record<string, Primitive | undefined>;
  lists: ListLookup;
  /** Row id and target field, for the problem a converter reports. */
  rowId?: string;
  field?: string;
  source?: string;
};

export type Applied = { ok: true; value: Primitive } | { ok: false; problem: MappingProblem };

const roundTo = (n: number, d: number) => { const f = 10 ** d; return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f; };

const label = (kind: string, lists: ListLookup) => lists(kind)?.label ?? kind.replace(/^custom:/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** One row's converter, BPMSquare -> ERP. An empty source is not a problem here: `ifEmpty` and the required check decide. */
export function applyConverter(conv: Converter, value: Primitive | undefined, ctx: ApplyCtx): Applied {
  const fail = (code: MappingProblem["code"], message: string, fix: string, extra: Partial<MappingProblem> = {}): Applied =>
    ({ ok: false, problem: { code, message, fix, rowId: ctx.rowId, field: ctx.field, ...extra } });
  switch (conv.kind) {
    case "constant": return { ok: true, value: conv.value };
    case "concat": {
      const read = (f: string) => { const v = ctx.record[f]; return isEmpty(v) ? "" : String(v); };
      let out = "";
      // Today's `{a} · {b}` templates leave the whole field out when any part is empty; a standard row keeps doing so.
      if (conv.requireAll && conv.parts.some((p) => "field" in p && read(p.field) === "")) return { ok: true, value: null };
      if (!conv.skipEmpty) {
        for (const p of conv.parts) out += "field" in p ? read(p.field) : p.text;
        return { ok: true, value: out.trim() === "" ? null : out };
      }
      // A separator belongs to the field that follows it (a trailing one to the field before it): it goes when that field is empty.
      let pending = "";
      let any = false;
      let lastNonEmpty = false;
      for (const p of conv.parts) {
        if ("text" in p) { pending += p.text; continue; }
        const v = read(p.field);
        if (v !== "") { out += pending + v; any = true; lastNonEmpty = true; } else lastNonEmpty = false;
        pending = "";
      }
      if (pending && lastNonEmpty) out += pending;
      return { ok: true, value: any ? out : null };
    }
    case "split": {
      if (isEmpty(value)) return { ok: true, value: null };
      const parts = String(value).split(conv.sep);
      const i = conv.index === -1 ? parts.length - 1 : conv.index;
      const piece = parts[i];
      return { ok: true, value: piece === undefined || piece === "" ? null : piece };
    }
    default: break;
  }
  if (isEmpty(value)) return { ok: true, value: null };
  switch (conv.kind) {
    case "value_list": {
      const list = ctx.lists(conv.list);
      const key = String(value).trim();
      const row = list?.rows.find((r) => r.bpm === key) ?? list?.rows.find((r) => r.bpm.toLowerCase() === key.toLowerCase());
      if (row && row.erp.trim() !== "") return { ok: true, value: row.erp };
      const name = label(conv.list, ctx.lists);
      return fail("value_unmapped", `${name} '${key}' has no ERP code.`, "Add it in Mapping > Value mapping, then Restart.", { list: conv.list, value: key });
    }
    case "date": {
      const p = parseDateValue(value);
      if (!p) return fail("bad_date", `'${String(value).slice(0, 40)}' is not a date.`, "Correct the date on the record, then Restart.", { value: String(value).slice(0, 40) });
      return { ok: true, value: formatDate(p, conv.format) };
    }
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.trim().replace(/,/g, "")) : NaN;
      if (!Number.isFinite(n)) return fail("bad_number", `'${String(value).slice(0, 40)}' is not a number.`, "Correct the number on the record, then Restart.", { value: String(value).slice(0, 40) });
      let x = n * (conv.scale ?? 1);
      if (conv.decimals !== undefined) x = roundTo(x, conv.decimals);
      else x = roundTo(x, 6);
      if (conv.asText) return { ok: true, value: x.toFixed(conv.decimals ?? 2) };
      return { ok: true, value: x };
    }
    case "text": {
      const s = String(value);
      if (conv.op === "trim") return { ok: true, value: s.trim() };
      if (conv.op === "upper") return { ok: true, value: s.toUpperCase() };
      if (conv.op === "lower") return { ok: true, value: s.toLowerCase() };
      return { ok: true, value: s.slice(0, conv.max ?? s.length) };
    }
    case "boolean": {
      const truthy = value === true || (typeof value === "number" && value !== 0) || (typeof value === "string" && ["true", "1", "yes", "y", "x", "on"].includes(value.trim().toLowerCase()));
      return { ok: true, value: truthy ? conv.trueValue : conv.falseValue };
    }
  }
}

/** `ifEmpty` after the converter: the default used when the source gave nothing. */
export function withDefault(v: Primitive | undefined, ifEmpty: string | null): Primitive {
  return isEmpty(v) ? (ifEmpty !== null && ifEmpty !== "" ? ifEmpty : null) : (v as Primitive);
}

// ── Reverse (the ERP value back into BPMSquare) ──────────────────────────────

export type Reversed = { value: Primitive; unknown?: { list: string; value: string }; bad?: boolean };

/** One inbound row's converter. An unknown code is kept raw (or becomes the list's default) and reported, never an error. */
export function reverseConverter(conv: Converter | null, erpValue: unknown, lists: ListLookup): Reversed {
  if (isEmpty(erpValue)) return { value: null };
  const raw: Primitive = typeof erpValue === "string" || typeof erpValue === "number" || typeof erpValue === "boolean" ? erpValue : String(erpValue);
  if (!conv) return { value: raw };
  switch (conv.kind) {
    case "value_list": {
      const list = lists(conv.list);
      const code = String(raw).trim();
      const matches = list?.rows.filter((r) => r.erp.trim() !== "" && (r.erp === code || r.erp.toLowerCase() === code.toLowerCase())) ?? [];
      const hit = matches.find((r) => r.inbound) ?? matches[0];
      if (hit) return { value: hit.bpm };
      if (list?.default_in) return { value: list.default_in, unknown: { list: conv.list, value: code } };
      return { value: raw, unknown: { list: conv.list, value: code } };
    }
    case "date": {
      const iso = parseFormatted(raw, conv.format);
      return iso === null ? { value: raw, bad: true } : { value: iso };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(/,/g, ""));
      if (!Number.isFinite(n)) return { value: raw, bad: true };
      return { value: roundTo(n / (conv.scale ?? 1), 6) };
    }
    case "text": return { value: typeof raw === "string" ? raw.trim() : raw };
    case "boolean": return { value: String(raw) === String(conv.trueValue) };
    default: return { value: raw };
  }
}
