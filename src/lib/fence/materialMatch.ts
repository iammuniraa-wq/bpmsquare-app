// Pure materials contract (Fence Configurator Phase C,
// docs/fence-configurator-architecture.md §7) -- no framework import, no
// "server-only", so this ships in the client bundle. Used both by
// materials.ts's server adapter (resolveFenceMaterials fetches the
// catalog, then calls matchMaterials here) and directly by the
// fence-preview client component, which fetches the catalog once per page
// load and re-matches on every slider change without a round trip, so the
// readout stays "one frame" per the UX bar (§1b).
//
// The matching key is `products.custom_data.fence_kind` plus a coating
// tag -- e.g. a line post is tagged
// `{ "fence_kind": "line_post", "pipe_class": "SS40", "coating": "PVC coated" }`.
// NOT YET MODELLED: hardware sized to match a specific post diameter
// (their own catalog has "Tension band Ø60.3" vs "Ø48.3" as distinct
// SKUs) -- v1 matches by fence_kind + coating only, same honesty caveat
// as geometry.ts's post-count split. Needs a diameter dimension before
// this feeds a real customer quote.

import type { FenceGeometryResult } from "./geometry";
import type { BomLine } from "./bom";

export type FenceMaterialKind =
  | "line_post"
  | "straining_post"
  | "corner_post"
  | "terminal_post"
  | "gate_post"
  | "fabric"
  | BomLine["kind"];

export interface MaterialRequest {
  fence_kind: FenceMaterialKind;
  qty: number;
  uom: "pcs" | "sets" | "m" | "kg" | "m2";
}

export interface ResolvedMaterialLine extends MaterialRequest {
  product_id: string | null;
  product_name: string | null;
  list_price: number | null;
}

export interface FenceCatalogRow {
  id: string;
  name: string;
  list_price: number | null;
  custom_data: Record<string, unknown> | null;
}

export interface FenceSelections {
  pipe_class: string;
  mesh_spec: string;
  coating: string;
}

/** Pure: geometry + BOM + the tenant's chosen pipe/mesh/coating -> the flat
 *  request list Phase D prices one line at a time via priceDocumentLine().
 *  No product lookups here -- that's matchMaterials/resolveFenceMaterials. */
export function buildMaterialRequests(geometry: FenceGeometryResult, bom: BomLine[]): MaterialRequest[] {
  const requests: MaterialRequest[] = [];
  const post = (fence_kind: FenceMaterialKind, qty: number) => {
    if (qty > 0) requests.push({ fence_kind, qty, uom: "pcs" });
  };
  post("line_post", geometry.line_posts);
  post("straining_post", geometry.straining_posts);
  post("corner_post", geometry.corner_posts);
  post("terminal_post", geometry.terminal_posts);
  post("gate_post", geometry.gate_posts);
  if (geometry.fabric_area_m2 > 0) requests.push({ fence_kind: "fabric", qty: geometry.fabric_area_m2, uom: "m2" });
  for (const line of bom) requests.push({ fence_kind: line.kind, qty: line.qty, uom: line.unit === "sets" ? "sets" : line.unit });
  return requests;
}

const POST_KINDS = new Set<FenceMaterialKind>(["line_post", "straining_post", "corner_post", "terminal_post", "gate_post"]);

export function materialKey(fenceKind: FenceMaterialKind | string, selections: Partial<FenceSelections>): string {
  if (POST_KINDS.has(fenceKind as FenceMaterialKind)) return `${fenceKind}|pipe:${selections.pipe_class ?? ""}|coat:${selections.coating ?? ""}`;
  if (fenceKind === "fabric") return `fabric|mesh:${selections.mesh_spec ?? ""}|coat:${selections.coating ?? ""}`;
  return `${fenceKind}|coat:${selections.coating ?? ""}`;
}

export function catalogByKey(catalog: FenceCatalogRow[]): Map<string, FenceCatalogRow> {
  const byKey = new Map<string, FenceCatalogRow>();
  for (const row of catalog) {
    const cd = row.custom_data ?? {};
    const key = materialKey((cd.fence_kind as string) ?? "", {
      pipe_class: typeof cd.pipe_class === "string" ? cd.pipe_class : undefined,
      mesh_spec: typeof cd.mesh_spec === "string" ? cd.mesh_spec : undefined,
      coating: typeof cd.coating === "string" ? cd.coating : undefined,
    });
    byKey.set(key, row);
  }
  return byKey;
}

/** Distinct values of one custom_data field across catalog rows of one
 *  fence_kind -- used to populate the pipe-class / mesh-spec pickers from
 *  what the tenant's catalog actually has, instead of a hardcoded list. */
export function distinctValues(catalog: FenceCatalogRow[], fenceKinds: FenceMaterialKind[], field: "pipe_class" | "mesh_spec"): string[] {
  const set = new Set<string>();
  for (const row of catalog) {
    const cd = row.custom_data ?? {};
    if (!fenceKinds.includes(cd.fence_kind as FenceMaterialKind)) continue;
    if (typeof cd[field] === "string") set.add(cd[field] as string);
  }
  return [...set].sort();
}

/** Rough "how fine is this mesh" signal parsed from the tenant's own label
 *  (e.g. "Chain-link 16x16 . 4.9mm (mini-mesh)") -- tenant-authored specs
 *  follow a "WxH · wire-mm" convention (scripts/seed-fence-materials-demo.sql's
 *  own naming), so reading the first NxN number is a generic heuristic that
 *  works for any tenant's real catalog without hardcoding specific mesh
 *  names. Shared by the mesh-fineness swatch preview (FenceConfigurator)
 *  and the actual 3D fabric texture (Fence3DView) so the preview matches
 *  what the 3D view then shows. */
export function meshGapPx(meshSpec: string): number {
  const m = meshSpec.match(/(\d+)\s*[x×]\s*\d+/i);
  const size = m ? parseInt(m[1], 10) : 40;
  return Math.max(6, Math.min(26, Math.round(size * 0.5)));
}

export function matchMaterials(requests: MaterialRequest[], catalog: FenceCatalogRow[], selections: FenceSelections): ResolvedMaterialLine[] {
  const byKey = catalogByKey(catalog);
  return requests.map((req) => {
    const match = byKey.get(materialKey(req.fence_kind, selections));
    return {
      ...req,
      product_id: match?.id ?? null,
      product_name: match?.name ?? null,
      list_price: match?.list_price ?? null,
    };
  });
}
