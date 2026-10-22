import type { ErpField } from "../metadata";
import type { FieldType, TargetField } from "../mapping/types";

// The adapter's own field list (Dataverse today) as TargetFields, with the two things the mapping engine needs and the
// older list did not carry: the codes of a choice column (so a value list can be proposed) and the table a lookup points
// at (so a text field is never proposed into one). Pure.

const DATAVERSE_TYPE: Record<string, FieldType> = {
  String: "text", Memo: "text", Uniqueidentifier: "text", EntityName: "text", Virtual: "text", ManagedProperty: "text",
  Integer: "integer", BigInt: "integer",
  Decimal: "number", Double: "number", Money: "number",
  Boolean: "boolean", DateTime: "datetime",
  Picklist: "enum", State: "enum", Status: "enum",
  Lookup: "lookup", Customer: "lookup", Owner: "lookup",
  // OData $metadata and sample rows
  Int16: "integer", Int32: "integer", Int64: "integer", Byte: "integer", SByte: "integer", Single: "number", Number: "number",
  DateTimeOffset: "datetime", Date: "date",
};

export function erpFieldType(raw: string): FieldType {
  return DATAVERSE_TYPE[raw] ?? "text";
}

export function erpFieldToTarget(f: ErpField): TargetField {
  const type = f.enum?.length ? "enum" : f.lookup ? "lookup" : erpFieldType(f.type);
  const out: TargetField = { path: f.name, label: f.label, type, required: f.required, creatable: f.creatable };
  if (f.enum?.length) out.enum = f.enum;
  if (f.enumLabels && Object.keys(f.enumLabels).length) out.enumLabels = f.enumLabels;
  if (f.lookup) out.lookup = f.lookup;
  return out;
}

const labelOf = (l: unknown): string => {
  const x = l as { UserLocalizedLabel?: { Label?: string } | null; LocalizedLabels?: { Label?: string }[] } | null | undefined;
  return x?.UserLocalizedLabel?.Label?.trim() || x?.LocalizedLabels?.[0]?.Label?.trim() || "";
};

/** `.../Attributes/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`. */
export function parsePicklists(json: unknown): Record<string, { codes: string[]; labels: Record<string, string> }> {
  const out: Record<string, { codes: string[]; labels: Record<string, string> }> = {};
  for (const a of ((json as { value?: unknown[] } | null)?.value ?? []) as Record<string, unknown>[]) {
    if (!a || typeof a !== "object") continue;
    const name = typeof a.LogicalName === "string" ? a.LogicalName : null;
    const options = (a.OptionSet as { Options?: unknown[] } | null)?.Options;
    if (!name || !Array.isArray(options)) continue;
    const codes: string[] = [];
    const labels: Record<string, string> = {};
    for (const o of options as { Value?: unknown; Label?: unknown }[]) {
      if (typeof o.Value !== "number" || !Number.isInteger(o.Value)) continue;
      const code = String(o.Value);
      codes.push(code);
      labels[code] = labelOf(o.Label) || code;
    }
    if (codes.length) out[name] = { codes: codes.slice(0, 500), labels };
  }
  return out;
}

/** `.../Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,Targets`. */
export function parseLookupTargets(json: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ((json as { value?: unknown[] } | null)?.value ?? []) as Record<string, unknown>[]) {
    if (!a || typeof a !== "object") continue;
    const name = typeof a.LogicalName === "string" ? a.LogicalName : null;
    const t = Array.isArray(a.Targets) ? (a.Targets as unknown[]).find((x): x is string => typeof x === "string" && /^[a-z][a-z0-9_]*$/.test(x)) : undefined;
    if (name && t) out[name] = t;
  }
  return out;
}

export function enrichFields(fields: ErpField[], picklists: ReturnType<typeof parsePicklists>, lookups: Record<string, string>): ErpField[] {
  return fields.map((f) => {
    const p = picklists[f.name];
    if (p) return { ...f, enum: p.codes, enumLabels: p.labels };
    const l = lookups[f.name];
    return l ? { ...f, lookup: l } : f;
  });
}
