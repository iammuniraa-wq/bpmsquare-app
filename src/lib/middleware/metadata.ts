// The ERP's own field list as the pick-list for mapping (owner addition A,
// docs/design/integration-middleware.md). Pure: parse what the ERP returned,
// suggest matches by name, flag required fields nobody mapped.

export type ErpField = { name: string; label: string; type: string; required: boolean; creatable: boolean };

export const METADATA_ENTITIES = [
  "quote", "quote_line", "sales_order", "sales_order_line", "account", "contact", "product", "project", "customers", "contacts", "vendors", "products", "projects",
] as const;
export type MetadataEntity = (typeof METADATA_ENTITIES)[number];

export const isMetadataEntity = (v: unknown): v is MetadataEntity => typeof v === "string" && (METADATA_ENTITIES as readonly string[]).includes(v);

const humanize = (k: string) => k.replace(/@odata\.bind$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

function sortFields(fields: ErpField[]): ErpField[] {
  return fields.sort((a, b) => Number(b.required) - Number(a.required) || a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
}

// ── Dataverse ───────────────────────────────────────────────────────────────

/** `EntityDefinitions(LogicalName='x')/Attributes?$select=LogicalName,DisplayName,AttributeType,RequiredLevel,IsValidForCreate,AttributeOf` */
export function parseDataverseAttributes(json: unknown): ErpField[] {
  const rows = ((json as { value?: unknown[] } | null)?.value ?? []) as Record<string, unknown>[];
  const out: ErpField[] = [];
  for (const r of rows) {
    const name = typeof r.LogicalName === "string" ? r.LogicalName : null;
    if (!name) continue;
    // Shadow columns (the _base money copies, yomi names) belong to another attribute.
    if (r.AttributeOf !== null && r.AttributeOf !== undefined && r.AttributeOf !== "") continue;
    const label = (r.DisplayName as { UserLocalizedLabel?: { Label?: string } } | null)?.UserLocalizedLabel?.Label;
    const level = (r.RequiredLevel as { Value?: string } | null)?.Value;
    out.push({
      name,
      label: label?.trim() || humanize(name),
      type: typeof r.AttributeType === "string" ? r.AttributeType : "Unknown",
      required: level === "SystemRequired" || level === "ApplicationRequired",
      creatable: r.IsValidForCreate !== false,
    });
  }
  return sortFields(out);
}

// ── OData $metadata (Finance and Operations, Business Central) ─────────────

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

/**
 * The properties of the entity type behind one entity set in an OData
 * `$metadata` document. A non-nullable property is "required". The document
 * can be large (Finance and Operations), so this scans with regular
 * expressions instead of building a tree.
 */
export function parseODataMetadata(xml: string, entitySet: string): ErpField[] {
  const setTag = new RegExp(`<EntitySet\\b[^>]*\\bName="${escapeRe(entitySet)}"[^>]*>`, "i").exec(xml);
  if (!setTag) return [];
  const typeName = attr(setTag[0], "EntityType")?.split(".").pop();
  if (!typeName) return [];
  const typeBlock = new RegExp(`<EntityType\\b[^>]*\\bName="${escapeRe(typeName)}"[^>]*>([\\s\\S]*?)</EntityType>`, "i").exec(xml);
  if (!typeBlock) return [];
  const body = typeBlock[1];
  const keys = new Set([...body.matchAll(/<PropertyRef\b[^>]*\bName="([^"]+)"/gi)].map((m) => m[1]));
  const out: ErpField[] = [];
  for (const m of body.matchAll(/<Property\b[^>]*>/gi)) {
    const name = attr(m[0], "Name");
    if (!name) continue;
    const type = (attr(m[0], "Type") ?? "Edm.String").replace(/^Edm\./, "");
    out.push({ name, label: humanize(name), type, required: attr(m[0], "Nullable") === "false" || keys.has(name), creatable: true });
  }
  return sortFields(out);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The fallback when `$metadata` is too large or refused: the keys of a sample row. */
export function fieldsFromSampleRow(row: Record<string, unknown> | null | undefined): ErpField[] {
  if (!row) return [];
  const out: ErpField[] = [];
  for (const [name, v] of Object.entries(row)) {
    if (name.startsWith("@") || name.includes("@OData") || name.includes("@odata")) continue;
    const type = v === null || v === undefined ? "Unknown" : typeof v === "number" ? "Number" : typeof v === "boolean" ? "Boolean" : "String";
    out.push({ name, label: humanize(name), type, required: false, creatable: true });
  }
  return sortFields(out);
}

// ── Required fields not yet mapped ──────────────────────────────────────────

const stripBind = (f: string) => f.replace(/@odata\.bind$/, "");

/** True when `mapped` (a field name from a map, maybe `x@odata.bind`) fills `attrName`. */
function fills(mapped: string, attrName: string): boolean {
  const m = stripBind(mapped).toLowerCase();
  const a = attrName.toLowerCase();
  // A Dataverse lookup is bound by navigation property: customerid -> customerid_account@odata.bind.
  return m === a || m.startsWith(`${a}_`);
}

/**
 * Required, creatable ERP fields that no map entry fills. `always` lists the
 * fields the engine sets itself whatever the map says (for a Dataverse quote:
 * the name and the customer, price list and currency binds), so they are never
 * reported as missing.
 */
export function missingRequired(erpFields: readonly ErpField[], mappedFields: readonly string[], always: readonly string[] = []): ErpField[] {
  return erpFields.filter((f) => f.required && f.creatable && ![...mappedFields, ...always].some((m) => fills(m, f.name)));
}

// ── Suggest mapping ─────────────────────────────────────────────────────────

export type BpmField = { key: string; label: string };
export type Suggestion = { bpm: string; erp: string; score: number; reason: "same name" | "same label" | "known pair" | "similar name" };

/** Names the two sides commonly use for the same thing. */
const SYNONYMS: Record<string, string[]> = {
  name: ["name", "fullname", "displayname", "organizationname", "searchname", "subject"],
  phone: ["telephone1", "phone", "phonenumber", "primarycontactphone", "primaryphonenumber", "mobilephone"],
  email: ["emailaddress1", "email", "primarycontactemail", "primaryemailaddress"],
  city: ["address1_city", "city", "addresscity"],
  sku: ["productnumber", "itemnumber", "number", "sku"],
  code: ["number", "projectid", "code"],
  list_price: ["price", "unitprice", "salesprice", "listprice"],
  uom: ["baseunitofmeasurecode", "salesunitsymbol", "defaultuomid", "uom", "unit"],
  description: ["description", "notes"],
  role: ["jobtitle", "role"],
  total: ["totalamount", "total", "amount"],
  qty: ["quantity", "qty"],
  rate: ["priceperunit", "unitprice", "rate"],
};

const norm = (s: string) => stripBind(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function tokens(s: string): string[] {
  return stripBind(s).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

/**
 * Match BPMSquare fields to ERP fields by name and label. Each ERP field is
 * used once; only matches worth proposing are returned (the screen shows them
 * for the admin to accept). Creatable fields are preferred.
 */
export function suggestMapping(bpmFields: readonly BpmField[], erpFields: readonly ErpField[]): Suggestion[] {
  const out: Suggestion[] = [];
  const used = new Set<string>();
  const pool = erpFields.filter((f) => f.creatable);
  const candidates: Suggestion[] = [];
  for (const b of bpmFields) {
    const bn = norm(b.key);
    const bl = norm(b.label);
    const bt = new Set([...tokens(b.key), ...tokens(b.label)]);
    const syn = (SYNONYMS[b.key] ?? []).map(norm);
    for (const f of pool) {
      const fn = norm(f.name);
      const fl = norm(f.label);
      if (fn === bn) candidates.push({ bpm: b.key, erp: f.name, score: 1, reason: "same name" });
      else if (fl === bl || fl === bn || fn === bl) candidates.push({ bpm: b.key, erp: f.name, score: 0.95, reason: "same label" });
      else if (syn.includes(fn)) candidates.push({ bpm: b.key, erp: f.name, score: 0.85 - syn.indexOf(fn) * 0.01, reason: "known pair" });
      else {
        const ft = new Set([...tokens(f.name), ...tokens(f.label)]);
        const shared = [...bt].filter((t) => ft.has(t)).length;
        const union = new Set([...bt, ...ft]).size;
        const j = union ? shared / union : 0;
        if (shared >= 1 && j >= 0.5) candidates.push({ bpm: b.key, erp: f.name, score: 0.5 + j * 0.2, reason: "similar name" });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.bpm.localeCompare(b.bpm) || a.erp.localeCompare(b.erp));
  const taken = new Set<string>();
  for (const c of candidates) {
    if (taken.has(c.bpm) || used.has(c.erp)) continue;
    taken.add(c.bpm);
    used.add(c.erp);
    out.push(c);
  }
  return out;
}
