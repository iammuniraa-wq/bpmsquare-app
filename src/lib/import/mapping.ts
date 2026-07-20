import type { ColumnMapping, FieldSpec, ObjectSpec } from "./types";

/** Collapses case, punctuation and spacing so "Company Name" matches "company_name". */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[\s_\-.()[\]/\\]+/g, "").replace(/[^a-z0-9]/g, "");
}

function candidatesFor(field: FieldSpec): string[] {
  return [field.key, field.label, ...(field.aliases ?? [])].map(normalise);
}

export type MappingSuggestion = {
  mapping: ColumnMapping;
  unmappedHeaders: number[];
  missingRequired: FieldSpec[];
};

/**
 * Matches file headers to field keys. Exact key matches win outright so a file
 * produced from our own template always maps perfectly; alias matches fill in
 * the rest. Each field is claimed at most once.
 */
export function suggestMapping(headers: string[], spec: ObjectSpec): MappingSuggestion {
  const mapping: ColumnMapping = {};
  const claimed = new Set<string>();

  const exactByKey = new Map<string, FieldSpec>();
  for (const field of spec.fields) exactByKey.set(normalise(field.key), field);

  headers.forEach((header, index) => {
    const norm = normalise(header);
    if (!norm) { mapping[index] = null; return; }
    const field = exactByKey.get(norm);
    if (field && !claimed.has(field.key)) {
      mapping[index] = field.key;
      claimed.add(field.key);
    }
  });

  headers.forEach((header, index) => {
    if (mapping[index] !== undefined) return;
    const norm = normalise(header);
    if (!norm) { mapping[index] = null; return; }

    const match = spec.fields.find(
      (field) => !claimed.has(field.key) && candidatesFor(field).includes(norm)
    );

    if (match) {
      mapping[index] = match.key;
      claimed.add(match.key);
    } else {
      mapping[index] = null;
    }
  });

  const unmappedHeaders = headers
    .map((_, i) => i)
    .filter((i) => mapping[i] === null && headers[i].trim() !== "");

  const missingRequired = spec.fields.filter((f) => f.required && !claimed.has(f.key));

  return { mapping, unmappedHeaders, missingRequired };
}

/** Turns a raw row plus a mapping into field-keyed values. */
export function applyMapping(row: string[], mapping: ColumnMapping): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [indexStr, key] of Object.entries(mapping)) {
    if (!key) continue;
    const value = row[Number(indexStr)];
    if (value != null && value !== "") values[key] = value;
  }
  return values;
}
