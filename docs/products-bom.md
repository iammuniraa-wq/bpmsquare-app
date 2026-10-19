# Products: item types and BOM kits (2026-10-19)

Owner decisions of 2026-10-19. Migration `0133_item_types_and_bom.sql` (applied on dev and production) adds
`products.item_type` and the table `product_bom_lines`. No other SQL.

## 1. Item types

A product has one optional item type. The column is plain text with no check constraint: the app validates
against the tenant's own list, so a tenant can rename, hide or add types without a migration.

| Key | Label | Stocked | Sellable | Purchasable | Components |
|---|---|---|---|---|---|
| `finished_product` | Finished product | yes | yes | no | no |
| `semi_finished` | Semi-finished | yes | no | no | no |
| `raw_material` | Raw material | yes | no | yes | no |
| `bought_out_component` | Bought-out component | yes | yes | yes | no |
| `consumable` | Consumable | yes | no | yes | no |
| `custom_made_to_order` | Custom / made to order | no | yes | no | no |
| `service` | Service | no | yes | no | no |
| `tool_equipment` | Tool / equipment | yes | no | yes | no |
| `certification_document` | Certification / document | no | yes | yes | no |
| `bom_kit` | BOM / kit | no | yes | no | **yes** |

The flags are informational today (nothing blocks selling a "not sellable" type). Null or unknown means
unclassified and behaves exactly as products did before.

- Code: `src/lib/products/itemTypes.ts` (client-safe: defaults, `resolveItemTypes`, `validateItemType`,
  `itemTypeFromCell`, `sanitizeItemTypeConfig`), `itemTypesServer.ts` (config read, write check).
- Tenant overrides live in `tenants.config.item_types`: `labels` (renames of built-ins), `hidden` (keys) and
  `custom` (added types with their stocked / sellable / purchasable flags). Custom types never have components.
- Settings -> Data -> Item types (`/settings/item-types`, admin only, Products module). API:
  `/api/settings/item-types` (GET / PUT, admin). A custom type that products still carry can be hidden but not removed.
- A hidden type stays on the products that have it and can be kept on edit, but cannot be newly assigned.

Surfaces: Product type and FIELD_REGISTRY (select filled server-side from the tenant's list), products API
(POST / PATCH validate against the list), change history, create form, record badge and fact, list column,
filter and search, Data Workbench (import takes label or key, export emits the key, update by id only),
v1 `/api/v1/products` (`item_type` field and filter), `LIST_SOURCES` (so `/ask`), MCP 1.10.0.

## 2. The kit rule

Only a BOM / kit can have components. Finished and semi-finished items cannot. Enforced in the add-component
API (400 with a clear message) and in Data Workbench import. A kit that still has components cannot be changed to
another type (record API, and Data Workbench update); changing a product TO kit is always fine.
A non-kit product shows no Components tab; every product shows a "Used in" tab.

## 3. Roll-up rules (`src/lib/products/bom.ts`, pure)

- A consumed line adds `qty x (1 + scrap% / 100) x unit cost`.
- Unit cost of a component that is a kit WITH lines is its own rolled-up total; otherwise its stored `cost_price`.
- A `used` line (a tool) is listed, adds nothing, and is never counted as missing.
- A component with no cost is never counted as zero: it is listed as missing and the roll-up is `incomplete`.
- `asOf` is the oldest `cost_price_as_of` among the stored costs used; `undated` counts costs with no date.
- Kits nest to 8 levels. A loop or a ninth level is reported in `errors`, the branch is left out and the roll-up is incomplete.
- Rounding: each line to 2 dp, unit costs to 4 dp, half away from zero. The total is the sum of the rounded lines.

## 4. API

All routes: `requireTenantUser()` first, Products module on, Products workcenter view (reads) or edit (writes).
Every foreign id is checked with `.eq("id").eq("tenant_id")`; line keys are the line's own id plus the parent id.

- `GET /api/products/[id]/bom` lines with component name / sku / type / cost, and the roll-up.
- `POST /api/products/[id]/bom` add a component (parent must be a kit, not itself, no loop, depth <= 8, unique per parent, qty > 0, scrap 0-100).
- `PATCH` / `DELETE /api/products/[id]/bom/[lid]`.
- `GET /api/products/[id]/bom/candidates?q=` the add picker (leaves out itself, current components, and anything that contains it).
- `POST /api/products/[id]/bom/apply-cost` writes the total to `cost_price` and today to `cost_price_as_of`. Refused (409) while the roll-up is incomplete unless `{ "allowIncomplete": true }`. This is how the pricing engine picks the kit cost up: it already reads those two columns, so the engine is unchanged.
- `GET /api/products/[id]/where-used`.
- Deleting a product that is a component returns 409 naming the BOMs (FK is RESTRICT); deleting a kit removes its lines (cascade).
- Every mutation is change-logged on the parent product.

## 5. Data Workbench

Object `product_bom_lines` (feature: products): import (parent and component by SKU or product ID), export (line id, both products' ids and SKUs), update by line id only. Not exposed in v1 or MCP: BOM structure and cost are internal.

## 6. Not built

- BOM versions and effective dates.
- Stock consumption when a kit is sold or produced.
- RFQ from a BOM's components.
- ERP BOM export / sync.
- Using item-type flags to restrict anything (they are descriptive).
- Automatic re-application of the cost when a component's cost changes (apply is a manual, confirmed step).

## 7. Used by the Project Estimator

An estimate template rule or a hand-added estimate line can name a product or a BOM / kit (by SKU or product reference). A kit with components and a complete roll-up is costed from that roll-up (the same `rollUpBom`), read live when the estimate is calculated; it does not need "Apply to product cost" first, though applying it keeps the stored cost and the engine in step. A kit whose roll-up is incomplete is never used as its cost: the stored cost is the fallback and the estimate line is flagged. See `docs/estimator-architecture.md` section 17.
