import type { Confidence, Converter, FieldType, MapRow, SourceField, TargetField, ValueListRow } from "./types";

// The deterministic proposal (spec section 3): normalise both sides, score each (source, target) pair by name,
// label, a table of known pairs and shared words, gate by type, take each target once. Pure and stable: the same
// input always gives the same rows, in the same order. Replaces and absorbs `suggestMapping` in metadata.ts.

// ── Normalising ──────────────────────────────────────────────────────────────

/** A target-side custom prefix: msdyn_, new_, cr1a2_, address1_. Applied to the ERP's names only: a BPMSquare key such as
 *  `customer_name` is an ordinary two-word name, not a prefixed one. */
const CUSTOM_PREFIX = /^[a-z][a-z0-9]{1,7}_/;

export function normaliseName(raw: string, side: "source" | "target"): string {
  const bound = /@odata\.bind$/i.test(raw);
  let s = raw.replace(/@odata\.bind$/i, "").toLowerCase();
  // A Dataverse navigation property is `<lookup attribute>_<table>` (customerid_account): the attribute is the name.
  if (bound && /^[a-z0-9]+id_[a-z0-9_]+$/.test(s)) s = s.split("_")[0];
  s = s.replace(/^_+/, "").replace(/_value$/, "");
  if (side === "target") {
    const stripped = s.replace(CUSTOM_PREFIX, "");
    if (stripped.replace(/[^a-z0-9]/g, "").length >= 2) s = stripped;
  } else {
    s = s.replace(/^cf_/, "");
  }
  s = s.replace(/[^a-z0-9]/g, "");
  for (const tail of ["id", "code"]) {
    if (s.length > tail.length + 2 && s.endsWith(tail)) { s = s.slice(0, -tail.length); break; }
  }
  return s;
}

function tokens(raw: string): string[] {
  return raw.replace(/@odata\.bind$/i, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !/^\d+$/.test(t));
}

/** Source key (normalised) -> the target names (normalised) that usually mean the same thing. */
const SYNONYM_SOURCE: Record<string, string[]> = {
  name: ["fullname", "displayname", "organizationname", "subject", "searchname", "title", "customername"],
  ref: ["externaldocumentnumber", "customerreference", "purchaseorderbycustomer", "referencenumber", "reference", "yourreference"],
  title: ["name", "subject", "projectname", "description"],
  customer_name: ["customername", "accountname", "soldtoname", "companyname", "organization"],
  description: ["description", "productdescription", "linedescription", "itemdescription", "notes", "remarks", "comments", "text", "longtext"],
  summary: ["description", "shortdescription", "summary"],
  total: ["totalamount", "total", "grossamount", "netamount", "totalvalue"],
  subtotal: ["totallineitemamount", "subtotal", "netvalue", "totallineamount"],
  valid_until: ["effectiveto", "validto", "expirydate", "validuntil", "enddate", "expirationdate"],
  currency: ["transactioncurrency", "currency", "documentcurrency", "currencyisocode", "currencyisocode"],
  status: ["state", "status", "statuscode"],
  outcome: ["status", "outcome", "state"],
  qty: ["quantity", "orderquantity", "requestedquantity", "qty"],
  rate: ["priceperunit", "unitprice", "netprice", "price", "rate"],
  net_rate: ["netprice", "priceperunit", "unitprice", "netrate"],
  uom: ["unit", "uom", "salesunit", "orderquantityunit", "unitofmeasure", "baseunitofmeasure", "defaultuom", "unitsymbol"],
  amount: ["extendedamount", "lineamount", "baseamount", "amount", "netamount"],
  discount_pct: ["discountpercentage", "discountpercent", "discount"],
  sl_no: ["lineitemnumber", "lineno", "linenumber", "position", "itemno"],
  city: ["city", "addresscity"],
  phone: ["telephone1", "telephone", "phone", "phonenumber", "primarycontactphone", "mobilephone", "primaryphonenumber"],
  email: ["emailaddress", "emailaddress1", "email", "primarycontactemail", "primaryemailaddress"],
  sku: ["productnumber", "itemnumber", "number", "materialnumber", "sku", "productno"],
  role: ["jobtitle", "role", "position"],
  list_price: ["price", "unitprice", "salesprice", "listprice"],
  code: ["number", "project", "code", "projectnumber"],
  account_external_id: ["customer", "account", "parentcustomer", "customeraccount", "soldtoparty"],
  country: ["country", "countryregion", "addresscountry"],
};

const SYNONYMS = new Map<string, Set<string>>();
for (const [k, v] of Object.entries(SYNONYM_SOURCE)) SYNONYMS.set(normaliseName(k, "source"), new Set(v.map((x) => normaliseName(x, "target"))));

// ── Type compatibility ───────────────────────────────────────────────────────

export type Compat = { score: number; convert: Converter | null };
const NO: Compat = { score: 0, convert: null };

const NUMERIC = new Set<FieldType>(["number", "integer"]);

/** How well a BPMSquare value of `s` fits an ERP field of `t`, and the converter that makes it fit. */
export function typeCompat(s: FieldType, t: FieldType, listKind: string | null = null): Compat {
  if (t === "array" || t === "object" || t === "lookup" || s === "array" || s === "object" || s === "lookup") return NO;
  if (s === t) return s === "enum" ? { score: 0.8, convert: listKind ? { kind: "value_list", list: listKind } : null } : { score: 1, convert: null };
  if (NUMERIC.has(s) && NUMERIC.has(t)) return t === "integer" ? { score: 0.9, convert: { kind: "number", decimals: 0 } } : { score: 1, convert: null };
  if (s === "text" && NUMERIC.has(t)) return { score: 0.8, convert: t === "integer" ? { kind: "number", decimals: 0 } : { kind: "number" } };
  if (NUMERIC.has(s) && t === "text") return { score: 0.8, convert: { kind: "number", asText: true, decimals: s === "integer" ? 0 : 2 } };
  if ((s === "date" && t === "datetime") || (s === "datetime" && t === "date")) return { score: 0.9, convert: { kind: "date", format: t === "date" ? "iso-date" : "iso-datetime" } };
  if ((s === "date" || s === "datetime") && t === "text") return { score: 0.8, convert: { kind: "date", format: s === "date" ? "iso-date" : "iso-datetime" } };
  if (s === "text" && (t === "date" || t === "datetime")) return { score: 0.8, convert: { kind: "date", format: t === "date" ? "iso-date" : "iso-datetime" } };
  if ((s === "text" || s === "enum") && t === "enum") return { score: 0.8, convert: listKind ? { kind: "value_list", list: listKind } : null };
  if (s === "enum" && t === "text") return { score: 1, convert: null };
  if (s === "boolean" && t === "text") return { score: 0.8, convert: { kind: "boolean", trueValue: "true", falseValue: "false" } };
  return NO;
}

/** The value-list kind a target field implies, by its name; a custom kind otherwise. */
export function listKindFor(target: Pick<TargetField, "path" | "label">): string {
  const n = `${target.path} ${target.label}`.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  if (/\b(uom|unit)(s|code|id)?\b|unitofmeasure/.test(n)) return "unit";
  if (/currenc/.test(n)) return "currency";
  if (/countr/.test(n)) return "country";
  if (/payment ?terms?|paymentterm/.test(n.replace(/_/g, " ")) || /paymentterm/.test(n)) return "payment_terms";
  if (/incoterm/.test(n)) return "incoterms";
  if (/\b(status|state)(code)?\b/.test(n)) return "status";
  const slug = target.path.replace(/@odata\.bind$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return `custom:${slug || "list"}`;
}

// ── Proposal ─────────────────────────────────────────────────────────────────

export type ProposeInput = {
  source: SourceField[];
  target: TargetField[];
  /** The rows already in this block. `fill` keeps them and only fills what is empty; `replace` starts again. */
  existing: MapRow[];
  mode: "fill" | "replace";
  direction: "out" | "in";
  /** Target paths the engine sets itself whatever the map says (never reported as missing). */
  engineSets?: readonly string[];
  /** BPMSquare's own values per list kind (UOM_OPTIONS, ISO 4217 codes, country names, the quote statuses). */
  known?: Partial<Record<string, string[]>>;
  /** Value lists that already exist on the connection: not proposed again. */
  existingLists?: readonly string[];
};

export type ProposedList = { kind: string; label: string; rows: ValueListRow[]; default_in: null; proposed: true };

export type ProposeResult = { rows: MapRow[]; missingRequired: string[]; lists: ProposedList[] };

type Candidate = { s: SourceField; t: TargetField; score: number; base: number; confidence: Confidence; compat: Compat };

const REVERSIBLE: readonly Converter["kind"][] = ["value_list", "date", "number", "text", "boolean"];

export function propose(input: ProposeInput): ProposeResult {
  const kept = input.mode === "replace" ? [] : input.existing.filter((r) => r.source !== null || r.convert !== null);
  const usedTargets = new Set(kept.map((r) => r.target));
  const usedSources = new Set(kept.filter((r) => r.source).map((r) => r.source as string));

  const targets = input.target.filter((t) => t.creatable !== false && t.state !== "missing" && !usedTargets.has(t.path));
  // An inbound mapping may read one ERP field into only one BPMSquare field, and the other way round: a source is used once too.
  const sources = input.source.filter((s) => !usedSources.has(s.key));

  const candidates: Candidate[] = [];
  for (const s of sources) {
    const sn = normaliseName(s.key, "source");
    const sl = normaliseName(s.label, "source");
    const st = new Set([...tokens(s.key), ...tokens(s.label)]);
    const syn = SYNONYMS.get(sn);
    for (const t of targets) {
      const tn = normaliseName(t.path, "target");
      const tl = normaliseName(t.label, "target");
      let base = 0;
      if (sn && (sn === tn)) base = 1;
      else if (sl && (sl === tl || sl === tn || sn === tl)) base = 0.95;
      else if (syn && (syn.has(tn) || syn.has(tl))) base = 0.85;
      else {
        const tt = new Set([...tokens(t.path), ...tokens(t.label)]);
        const shared = [...st].filter((x) => tt.has(x)).length;
        const union = new Set([...st, ...tt]).size;
        const j = union ? shared / union : 0;
        if (shared >= 1 && j >= 0.5) base = 0.5 + j * 0.2;
      }
      if (base === 0) continue;
      const kind = t.type === "enum" || t.enum ? listKindFor(t) : null;
      const compat = typeCompat(s.type, t.type, kind);
      if (compat.score === 0) continue;
      // An inbound row reads the ERP value back through the reverse of its converter, so only reversible ones are proposed.
      if (input.direction === "in" && compat.convert && !REVERSIBLE.includes(compat.convert.kind)) continue;
      const confidence: Confidence = base >= 0.95 ? (compat.score < 1 ? "likely" : "sure") : base >= 0.85 ? "likely" : "guess";
      candidates.push({ s, t, base, score: base * compat.score, confidence, compat });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.s.key.localeCompare(b.s.key) || a.t.path.localeCompare(b.t.path));

  const takenS = new Set<string>();
  const takenT = new Set<string>();
  const added: MapRow[] = [];
  for (const c of candidates) {
    if (takenS.has(c.s.key) || takenT.has(c.t.path)) continue;
    takenS.add(c.s.key);
    takenT.add(c.t.path);
    added.push({
      id: `p:${c.t.path}`, target: c.t.path, source: c.s.key, convert: c.compat.convert, ifEmpty: null, origin: "proposed", confidence: c.confidence,
    });
  }
  added.sort((a, b) => a.target.localeCompare(b.target));
  const rows = [...kept, ...added];

  const filled = new Set(rows.filter((r) => r.source !== null || r.convert !== null).map((r) => r.target));
  const always = new Set((input.engineSets ?? []).map((p) => p.toLowerCase()));
  const missingRequired = input.target
    .filter((t) => t.required && t.creatable !== false && t.state !== "missing" && !filled.has(t.path) && !always.has(t.path.toLowerCase()) && !always.has(t.path.replace(/@odata\.bind$/i, "").toLowerCase()))
    .map((t) => t.label);

  return { rows, missingRequired, lists: proposeLists(rows, input) };
}

function proposeLists(rows: MapRow[], input: ProposeInput): ProposedList[] {
  const byPath = new Map(input.target.map((t) => [t.path, t]));
  const used = rows.filter((r) => r.convert?.kind === "value_list").map((r) => ({ kind: (r.convert as { list: string }).list, field: byPath.get(r.target) }));
  return listsFromFields(used.flatMap((u) => (u.field ? [{ kind: u.kind, field: u.field }] : [])), input.known ?? {}, input.existingLists ?? []);
}

/** A proposed list per kind: the target's own codes, matched by name (or label) to BPMSquare's values; the rest listed with an empty BPMSquare side. */
export function listsFromFields(items: { kind: string; field: TargetField }[], known: Partial<Record<string, string[]>>, skip: readonly string[] = []): ProposedList[] {
  const out = new Map<string, ProposedList>();
  for (const { kind, field } of items) {
    if (skip.includes(kind) || out.has(kind) || !field.enum?.length) continue;
    const byNorm = new Map((known[kind] ?? []).map((k) => [normaliseName(k, "source"), k]));
    const rowsOut: ValueListRow[] = [];
    const usedBpm = new Set<string>();
    for (const code of field.enum) {
      const hit = byNorm.get(normaliseName(code, "source")) ?? (field.enumLabels?.[code] ? byNorm.get(normaliseName(field.enumLabels[code], "source")) : undefined);
      const bpm = hit && !usedBpm.has(hit) ? hit : "";
      if (bpm) usedBpm.add(bpm);
      rowsOut.push({ bpm, erp: code, inbound: true });
    }
    const label = (kind.startsWith("custom:") ? kind.slice(7) : kind).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    out.set(kind, { kind, label, rows: rowsOut, default_in: null, proposed: true });
  }
  return [...out.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}
