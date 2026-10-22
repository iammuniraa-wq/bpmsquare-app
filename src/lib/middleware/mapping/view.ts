import type { MappingView, MapRow as StandardRow } from "../mappingDoc";
import { countFields } from "../schema/types";
import type {
  Converter, EngineMappingExtras, MapRow, MappingDocument, MappingTarget, MappingVersionInfo, SourceField, TargetField, ValueList,
} from "./types";

// Two pure translations: today's two-column preset view -> the rows of a MappingDocument ("materialise", spec section 1), and
// the answer of GET /api/middleware/mapping for the Mapping tab. The preset lane itself is never migrated.

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/**
 * `{ref} · {summary}` -> a join; `true` -> a fixed value; text without a placeholder -> a fixed value. A join built from a template
 * leaves the whole field out when a part is empty (`requireAll`), exactly as the template did. Null when it has too many parts.
 */
export function templateToConverter(tpl: string): Converter | null {
  const t = tpl.trim();
  if (t === "true") return { kind: "constant", value: true };
  if (t === "false") return { kind: "constant", value: false };
  const parts: ({ field: string } | { text: string })[] = [];
  let last = 0;
  for (const m of t.matchAll(PLACEHOLDER)) {
    if (m.index! > last) parts.push({ text: t.slice(last, m.index) });
    parts.push({ field: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < t.length) parts.push({ text: t.slice(last) });
  if (!parts.some((p) => "field" in p)) return { kind: "constant", value: t };
  if (parts.length > 6) return null;
  if (parts.some((p) => "text" in p && p.text.length > 40)) return null;
  return { kind: "concat", parts, requireAll: true };
}

export type Materialised = { header: MapRow[]; lines: MapRow[]; skipped: string[] };

/** The preset (or the tenant's older override) as engine rows. Composite rows come over as joins; nothing is dropped silently. */
export function materialiseStandard(view: Pick<MappingView, "sections" | "document">): Materialised {
  const out: Materialised = { header: [], lines: [], skipped: [] };
  for (const section of view.sections) {
    const block = section.key === "lines" ? out.lines : out.header;
    for (const r of section.rows as StandardRow[]) {
      if (!r.erp) continue;
      const origin: MapRow["origin"] = r.standard ? "standard" : "user";
      const id = `std:${section.key}:${r.erp.name}`;
      if (r.composite && r.id.startsWith("composite:")) {
        const convert = templateToConverter(r.composite);
        if (!convert) { out.skipped.push(`${r.erp.name}: its template is too long to edit here`); continue; }
        block.push({ id, target: r.erp.name, source: null, convert, ifEmpty: null, origin, confidence: null });
        continue;
      }
      const source = r.bpm.name;
      block.push({ id, target: r.erp.name, source, convert: null, ifEmpty: null, origin, confidence: null });
    }
  }
  return out;
}

export function emptyTarget(): MappingTarget {
  return { kind: "adapter", entity: "", linesPath: null, schema: { fetchedAt: new Date(0).toISOString(), sourceUrl: null, fields: [], lineFields: [] } };
}

export type ExtrasInput = {
  doc: MappingDocument | null;
  version: number | null;
  versions: MappingVersionInfo[];
  usingStandard: boolean;
  /** The preset rows, when there is no saved document. */
  standard: Materialised | null;
  /** The target as it is now (live adapter list, or the draft snapshot). Used when there is no saved document. */
  liveTarget: MappingTarget | null;
  sourceFields: { header: SourceField[]; lines: SourceField[] };
  missingRequired: string[];
  lists: ValueList[];
  ai: boolean;
};

export function buildExtras(i: ExtrasInput): EngineMappingExtras {
  const target = i.doc?.target ?? i.liveTarget ?? emptyTarget();
  const headerFields: TargetField[] = target.schema.fields;
  const lineFields: TargetField[] = target.schema.lineFields ?? [];
  const counts = countFields(headerFields, lineFields);
  const rows = i.doc ? { header: i.doc.header, lines: i.doc.lines } : { header: i.standard?.header ?? [], lines: i.standard?.lines ?? [] };
  return {
    engine: { active: !!i.doc, version: i.version, versions: i.versions, usingStandard: i.usingStandard },
    target: {
      kind: target.kind, entity: target.entity, linesPath: target.linesPath,
      schema: { fetchedAt: target.schema.fields.length || lineFields.length ? target.schema.fetchedAt : null, sourceUrl: target.schema.sourceUrl, counts },
    },
    sourceFields: i.sourceFields,
    targetFields: { header: headerFields, lines: lineFields },
    rows,
    missingRequired: i.missingRequired,
    lists: i.lists.map((l) => ({ kind: l.kind, label: l.label, rowCount: l.rows.length })),
    ai: { available: i.ai },
  };
}

/** Required, creatable target fields no row fills (and the engine does not fill itself), by label. */
export function missingFor(rows: MapRow[], fields: TargetField[], always: readonly string[]): string[] {
  const filled = new Set(rows.filter((r) => r.source !== null || r.convert !== null).map((r) => r.target.toLowerCase().replace(/@odata\.bind$/, "")));
  const skip = new Set(always.map((a) => a.toLowerCase()));
  return fields
    .filter((f) => f.required && f.creatable !== false && f.state !== "missing")
    .filter((f) => {
      const p = f.path.toLowerCase().replace(/@odata\.bind$/, "");
      // A Dataverse lookup is bound as `customerid_account@odata.bind`: a row for the bound name fills the attribute.
      return !skip.has(p) && ![...filled].some((x) => x === p || x.startsWith(`${p}_`));
    })
    .map((f) => f.label);
}

/** What a save changed, for the change history: counts and the fields that moved. Never a value, never a secret. */
export function diffRows(before: MapRow[], after: MapRow[]): { field: string; from: unknown; to: unknown }[] {
  const key = (r: MapRow) => `${r.source ?? ""}|${r.convert ? JSON.stringify(r.convert) : ""}|${r.ifEmpty ?? ""}`;
  const b = new Map(before.map((r) => [r.target, key(r)]));
  const a = new Map(after.map((r) => [r.target, key(r)]));
  const added = [...a.keys()].filter((t) => !b.has(t));
  const removed = [...b.keys()].filter((t) => !a.has(t));
  const changed = [...a.keys()].filter((t) => b.has(t) && b.get(t) !== a.get(t));
  const out: { field: string; from: unknown; to: unknown }[] = [{ field: "mapped fields", from: before.length, to: after.length }];
  const cut = (l: string[]) => l.slice(0, 20).join(", ");
  if (added.length) out.push({ field: "added", from: null, to: cut(added) });
  if (removed.length) out.push({ field: "removed", from: cut(removed), to: null });
  if (changed.length) out.push({ field: "changed", from: null, to: cut(changed) });
  return out;
}
