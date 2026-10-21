import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../_guard";
import { loadD365 } from "@/lib/connectors/d365/server";
import { D365_OUTBOUND_PRESETS, outboundConfig, entityConfig } from "@/lib/connectors/d365/catalog";
import { D365_ENTITY_KEYS } from "@/lib/connectors/d365/types";
import { PLACEHOLDERS } from "@/lib/middleware/payload";
import { getErpMetadata } from "@/lib/middleware/metadataServer";
import { isMetadataEntity, missingRequired, suggestMapping, type BpmField } from "@/lib/middleware/metadata";
import { isMappingDoc } from "@/lib/middleware/mappingDoc";
import { getMapping, saveMapping } from "@/lib/middleware/mappingOps";

// GET  -- the mapping in force for the connected product, so the Mapping tab opens read-only on it:
//   { product, using_standard: { quote, quote_line, project }   (true = "Using the standard mapping"),
//     effective: { quote, quote_line, project }, presets: { ... }   ("Reset to standard" = save outbound: null),
//     placeholders: { quote: string[], quote_line: string[], project: string[] },   (the {fields} BPMSquare offers)
//     entities: { <key>: { enabled, entity_set, id_field, key_field, field_map, schedule } } }  (inbound maps, effective)
//   Save an outbound change through PUT /api/middleware/connections/dynamics365 (config.outbound).
//
// POST { entity, bpm_fields?: [{ key, label }], mapped?: string[], always?: string[] }
//   -> { suggestions: [{ bpm, erp, score, reason }],        (name / label matches: "Suggest mapping")
//        missing: ErpField[] }                              (required, creatable ERP fields nothing in `mapped` fills)
//   Needs a connected ERP; uses the cached field list (/api/middleware/metadata).
//
// With `?document=<quote|customers|contacts|products|projects>` GET returns the two-column mapping instead (the older form above is
// what you get without it):
//   { document:{key,label,targetLabel}, sections:[{key:"header"|"lines",label,rows:[{id,bpm:{label,name},erp:{label,name}|null,standard,composite?}]}],
//     erpFields:{header:[{label,name}],lines:[...]}, usingStandard, missingRequired:[string], settings:{entity_set,id_field}|null }
//   or { connected:false }.
// PUT { document, section:"header"|"lines", rows:[{id, erp: string|null}], entity_set?, id_field? } saves those rows and answers with the mapping again.
//   422 { error, errors:[{id,message}] } names each row that is unknown, read-only (composite), not an ERP field or already used.
// POST /api/middleware/mapping/reset { document } is "Reset to standard".
export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const docParam = req.nextUrl.searchParams.get("document");
  if (docParam !== null) {
    if (!isMappingDoc(docParam)) return fail(422, "Choose quote, customers, contacts, products or projects.");
    return NextResponse.json(await getMapping(g.ctx.admin, g.ctx.tenantId, docParam));
  }
  const loaded = await loadD365(g.ctx.admin, g.ctx.tenantId);
  if (!loaded) return NextResponse.json({ connected: false });
  const { cfg } = loaded;
  const eff = outboundConfig(cfg);
  const preset = D365_OUTBOUND_PRESETS[cfg.product];
  const entities = Object.fromEntries(D365_ENTITY_KEYS.map((k) => [k, entityConfig(cfg, k)]));
  return NextResponse.json({
    connected: true,
    product: cfg.product,
    using_standard: { quote: !eff.custom.quote, quote_line: !eff.custom.quote_line, project: !eff.custom.project },
    effective: { quote: eff.quote, quote_line: eff.quote_line, project: { entity_set: eff.project.entity_set, id_field: eff.project.id_field, field_map: eff.project.field_map } },
    presets: preset,
    placeholders: PLACEHOLDERS,
    entities,
  });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ entity?: string; bpm_fields?: unknown; mapped?: unknown; always?: unknown }>(req);
  if (!isMetadataEntity(body.entity)) return fail(422, "Unknown entity.");
  const r = await getErpMetadata(g.ctx.tenantId, body.entity);
  if (!r.ok) return fail(r.state === "not_connected" ? 400 : 502, r.message, { state: r.state });
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
  const bpm: BpmField[] = Array.isArray(body.bpm_fields)
    ? (body.bpm_fields as { key?: unknown; label?: unknown }[]).filter((f) => typeof f?.key === "string").slice(0, 200).map((f) => ({ key: String(f.key), label: typeof f.label === "string" ? f.label : String(f.key) }))
    : [];
  return NextResponse.json({
    suggestions: bpm.length ? suggestMapping(bpm, r.fields) : [],
    missing: missingRequired(r.fields, strs(body.mapped), strs(body.always)),
  });
}

export async function PUT(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const r = await saveMapping(g.ctx.admin, g.ctx.tenantId, await jsonBody(req));
  return r.ok ? NextResponse.json(r.view) : fail(r.status, r.error, r.errors ? { errors: r.errors } : {});
}
