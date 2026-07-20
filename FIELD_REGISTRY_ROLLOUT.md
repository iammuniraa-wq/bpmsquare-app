# Field Registry Rollout — tracking doc

> **Why this file exists:** `FIELD_REGISTRY` (`src/lib/fieldRegistry.ts`) and the
> Adapt/rules system were built as a pilot for `account` + `contact` only
> (migration `0030_field_customization.sql`). Every other object with custom
> fields (`case`, `quote`, `work_order`, `asset`, `supplier`, `inventory`,
> `purchase_order`, `invoice`) still runs on the older `CustomFieldsSection`
> path with no registry, no Adapt drawer, no rules.
>
> Before touching Data Workbench again, every object must reach the same
> stage as account/contact — checked against this list, not by eye. No
> migration is required: `field_overrides.object_type` and
> `field_rules.object_type` already accept all ten values (0030 was written
> deliberately to avoid a constraint-widening migration later). This is
> **application-layer work only**.
>
> Update the tables below as each object lands. Do not start Data Workbench
> work until every row in "Phase 1" (and, once decided, "Phase 2") is ✅.

---

## Reference: what "done" means (derived from account/contact)

A field is "in the registry" when a **`StandardFieldDef`** exists for it in
`FIELD_REGISTRY[objectType].fields`, with:

- `key` — the real DB column name, never renamed
- `defaultLabel`, `widget`, `defaultSection`
- `locked` set on anything that must never be hidden (e.g. `name`)
- `editable: false` + `hiddenByDefault: true` on system fields not meant for
  the generic edit form (e.g. `created_at`, FK id columns like
  `referred_by_account_id`)
- `selectSource` (`"territory" | "sales_org"`) for tenant sales-config
  dropdowns, or `enumOptions` for fixed code-defined enums (never both)

An object is "at parity" when **all** of the following are true:

| # | Requirement | How to verify |
|---|---|---|
| 1 | Every real DB column for the object has a `StandardFieldDef` entry (or is deliberately excluded with a comment saying why) | Diff `FIELD_REGISTRY[type].fields` keys against the DB type in `src/lib/types.ts` |
| 2 | Object type added to the pilot type union and `isPilotObjectType` | `src/lib/fieldRegistry.ts` |
| 3 | `field-config` route returns standard + custom fields merged, in section order | `GET /api/settings/field-config?object=<type>` manually, confirm both kinds present |
| 4 | Adapt drawer opens for the object **with rules enabled**, not custom-fields-only mode | `src/components/AdaptObjectDrawer.tsx` — `supportsRules` becomes true automatically once `isPilotObjectType` includes the type; confirm in UI |
| 5 | Detail/edit page renders fields via `<ObjectSections objectType=... record=... patchUrl=... />`, not `<CustomFieldsSection>` | grep the object's detail page — see accounts pattern: `src/app/(app)/accounts/[id]/page.tsx:246` |
| 6 | `<CustomFieldsSection>` usage removed for this object (superseded by `ObjectSections`, which renders standard + custom together) | grep for the object's old wiring, e.g. `src/app/(app)/assets/[id]/page.tsx` |
| 7 | `field_overrides` (rename/hide/section/reorder) verified working for at least 2 standard fields via Adapt drawer, refresh persists | Manual: rename a field, hide a field, reload page |
| 8 | At least one `field_rules` condition (hide/show/require/optional) verified end-to-end | Manual: create a rule in Adapt, confirm it fires on a live record |
| 9 | No regressions on existing forms/pages that read the object's fields directly (search for hardcoded field lists bypassing the registry) | grep the object's `new/` create form and any print/PDF templates |
| 10 | Tenant extension conflicts resolved — check `src/extensions/*/index.tsx` for `extraCustomFields(objectType)` entries that duplicate a now-native/registry field | e.g. Vikas declares `make`/`rpm` as custom fields for `asset`, both already native `Asset` columns |

Line-item / child-collection objects (quote, invoice, purchase_order,
inventory transactions) additionally need **Decision A** below resolved
before their registry work starts.

---

## Open decision — blocks Phase 2

**Decision A: how do line items fit the field-config model?**
`EffectiveField` / `field_overrides` / `field_rules` describe a flat object.
Quote/invoice/PO line items are child rows with their own columns
(`description`, `qty`, `rate`, `discount_pct`, ...). Options to resolve
before Phase 2 starts:

- [ ] (a) Line-item columns are a separate `object_type` (e.g. `"quote_line"`) in the same registry/override/rule tables
- [ ] (b) Line items are out of scope for Adapt/rules entirely — only the header fields get registry treatment
- [ ] (c) Something else (record here once decided)

**Status:** ⬜ Not yet decided — revisit when Phase 1 is complete.

---

## Phase 1 — flat objects

| Object | 1. Registry entry | 2. Pilot type | 3. field-config merges | 4. Adapt + rules | 5. ObjectSections | 6. Old wiring removed | 7. Overrides verified | 8. Rule verified | 9. No regressions | 10. Extension conflicts checked | **Status** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| asset | ✅ | ✅ | ✅ | ✅ verified in prod | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Done |
| supplier | ✅ | ✅ | ✅ | ✅ (code, unverified in browser) | ✅ | ✅ | ⬜ manual check | n/a — no rules yet | ✅ typecheck+build clean | ✅ n/a | 🟡 Code complete, manual UI check pending |
| case | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🔲 Not started |
| work_order | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🔲 Not started |

Order: asset → supplier → case → work_order.

### asset — what landed

- **Migration** `supabase/migrations/0033_asset_nameplate_fields.sql` — 12
  nullable text columns: `rpm`, `frame_type`, `insulation_class`,
  `connection`, `duty`, `ambient_temp`, `output_kw`, `stator_voltage`,
  `stator_current`, `excitation_voltage`, `excitation_current`, `frequency`.
  **Not yet applied to the database** — no Supabase CLI in this repo, no DB
  access from the assistant. Must be run manually before any of this works
  end-to-end.
- **`src/lib/data/labels.ts`** — added `ASSET_KIND_LABEL` (used by the
  registry only; the 3 other pre-existing duplicate kind-label maps in
  `assets/page.tsx`, `assets/new/page.tsx`, and the now-deleted
  `AssetEditPanel.tsx` were deliberately left alone — matches account's own
  precedent of not being fully deduplicated either).
- **`src/lib/fieldRegistry.ts`** — `PilotObjectType` extended to include
  `"asset"`; `FIELD_REGISTRY.asset` added (Identity / Specifications /
  Nameplate / Notes sections). New: `DEFAULT_FIELD_RULES`, a **code-level**
  (not tenant-DB-row) rule set — hides the 12 nameplate fields unless
  `kind === "motor"`. Universal by construction: every tenant, current and
  future, gets it with zero seeding, since it's a source constant merged
  into `field-config`'s response, not a `field_rules` table row.
- **`src/app/api/settings/field-config/route.ts`** — merges
  `DEFAULT_FIELD_RULES[objectType]` ahead of tenant-authored `field_rules`.
- **`src/app/(app)/assets/[id]/page.tsx`** — swapped
  `<CustomFieldsSection>` for `<ObjectSections objectType="asset" ... />`.
- **`src/app/(app)/assets/[id]/AssetHeaderCard.tsx`** — stripped its bespoke
  edit toggle/form; now a display-only shell, matching `AccountHeader`'s
  documented rule ("editing happens in ObjectSections, not here").
- **`src/app/(app)/assets/[id]/AssetEditPanel.tsx`** — deleted (fully
  superseded by ObjectSections; its PATCH target had no business logic to
  preserve).
- **`src/extensions/vikas/index.tsx`** — removed `make` and `rpm` from
  `extraCustomFields("asset")` (exact duplicates of the new native columns).
  Left `frame_size`/`insulation` alone — different shape (plain text vs.
  select-with-options) from the new `frame_type`/`insulation_class`, not an
  exact duplicate; unresolved, not blocking.
- **`src/lib/types.ts`** — `Asset` type updated with the 12 new fields;
  `src/lib/data/seed.ts` (8 entries) and `QuoteForm.tsx`'s optimistic local
  Asset construction updated to match. `tsc --noEmit` and `npm run build`
  both clean.

### asset — post-verification fixes (found by user testing in prod)

- **Adapt drawer was never rendered.** The data layer (registry entry,
  pilot type, default rules) was wired but `AdaptObjectDrawer` itself was
  never added to the page — added to `AssetHeaderCard`, mirroring
  `AccountHeader`. Fixed in `2cc7f27`.
- **Tab title showed the raw record UUID.** Pre-existing bug in
  `tabs-context.tsx`'s `tabMeta()` — `/assets/new` and `/contacts/new` had
  branches, but `/assets/[id]` and `/contacts/[id]` detail routes didn't,
  so both fell through to the raw path segment as the initial tab title.
  Added the missing branches. Fixed in `2cc7f27`.
- **Nameplate fields exposed on Settings → Statuses & assets.** Two
  hardcoded field-label lists (`StatusesClient.tsx`'s print-field picker,
  `QuotePrintDocument.tsx`'s `ASSET_FIELD_LABELS`) predate the field
  registry and weren't touched by it — added the 12 nameplate fields to
  both so they're selectable for the quote print equipment section. Fixed
  in `412f16f`.

### asset — still open (non-blocking)

- **Decision B** (is_loaner/loaner_status): left out of the registry as
  agreed — no live workflow sets `loaner_status: "on_loan"` anywhere outside
  seed data, so no editability was added for it.
- **`frame_size`/`insulation` vs `frame_type`/`insulation_class`**: not
  reconciled — different shape (plain text vs. select-with-options), low
  priority, `extraCustomFields` is still dead code (never invoked).

### supplier — what landed

Simpler than asset: flat object, no bulk field addition, no extension
conflicts, no kind-conditional visibility need.

- **`src/lib/data/labels.ts`** — added `SUPPLIER_TYPE_LABEL`,
  `SUPPLIER_STATUS_LABEL` (neither existed before; the page had its own
  inline `TYPE_LABEL` duplicate, left in place — same as the asset-kind
  duplicates, not touched).
- **`src/lib/fieldRegistry.ts`** — `PilotObjectType` extended to include
  `"supplier"`; `FIELD_REGISTRY.supplier` added (Identity / Contact /
  Notes). No entry in `DEFAULT_FIELD_RULES` — nothing kind-conditional
  here.
- **`src/app/(app)/suppliers/[id]/page.tsx`** — the read-only "Contact
  information" card plus the separate `<CustomFieldsSection>` call are
  both replaced by one `<ObjectSections>`. `AdaptObjectDrawer` added via
  `PageHeader`'s existing `action` prop (a slot account/contact/asset
  don't use, since none of their pages route through a shared
  `PageHeader` the same way).
- **Genuine judgment call, not mechanical:** `SupplierEditPanel.tsx` had a
  **Delete supplier** button — real behavior `ObjectSections` has no
  equivalent for (account/contact never had a delete action to preserve,
  so there was no precedent here). Renamed to `DeleteSupplierButton.tsx`
  and stripped to just that — delete button + confirm + redirect, nothing
  else. Old file deleted, single import site updated.
- **Verified the PATCH route before treating this as done**, not just by
  analogy: `/api/suppliers/[id]` already whitelists exactly
  `name/type/city/phone/email/gstin/notes/status/custom_data` — the same
  shape `ObjectSections` PATCHes. No API changes needed.
- `tsc --noEmit` and `npm run build` both clean.

### supplier — still open

- **Not verified in a browser.** Same caveat as asset's first pass —
  implemented per the same code path account/contact/asset already use,
  but not clicked through manually. In particular: confirm the Adapt
  drawer opens correctly from `PageHeader`'s `action` slot (new usage
  pattern, not yet exercised elsewhere), and confirm delete still works
  end-to-end after the rename.

---

## Phase 2 — line-item objects

**Decision A resolved by inspection, not by design meeting.** Line-item
columns (`quote_lines`: description/uom/qty/rate/discount/amount) were
never field-customizable in any system, old or new — the old per-section
"Adapt" system only ever let a tenant group *custom fields* into sections,
never touched native line columns. So there was nothing to lose: quote
(and presumably invoice/purchase_order/inventory) get the registry
treatment for their **header** fields only, exactly like every flat
object. Line items stay out of scope until a real need appears.

| Object | 1. Registry entry | 2. Pilot type | 3. field-config merges | 4. Adapt + rules | 5. ObjectSections | 6. Old wiring removed | 7. Overrides verified | 8. Rule verified | 9. No regressions | 10. Extension conflicts checked | **Status** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| quote | ✅ | ✅ | ✅ | ✅ (code, unverified in browser) | ✅ | ✅ | ⬜ manual check | ⬜ manual check | ✅ typecheck+build clean | ✅ n/a | 🟡 Code complete, manual UI check pending |
| invoice | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🔲 Not started |
| purchase_order | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🔲 Not started |
| inventory | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🔲 Not started |

Order: quote → invoice → purchase_order → inventory (quote done first —
most complex, so its shape informs the other three).

### quote — what landed

By far the biggest of the four objects done so far — not a gap-fill like
asset/supplier, a **replacement of a real, working, independent system**.

- **Found, not assumed:** `QuoteDetailLayout.tsx` (904 lines) had its own
  complete per-section customization system — drag-to-reorder sections,
  create custom sections, add custom fields per-section — persisted per
  tenant to a real `page_layouts` table via `/api/layouts/[object]`. This
  is what the user meant by "adapt on every section." No DB access to
  verify emptiness myself — flagged the data-loss risk before removing
  anything; user confirmed no tenant has actually used it.
- **`src/components/QuoteDetailLayout.tsx`** — full rewrite. Removed:
  ~20 state variables and 8 handler functions (`loadCfDefs`,
  `handleSectionDragEnd`, `saveLayout`, `addSection`, `removeSection`,
  `addFieldToSection`, `removeFieldFromSection`, `saveCfValue`,
  `renderFieldInput`, `renderCfCards`, `renderSectionContent`), the
  "Adapt mode" banner, the drag-handle section wrapper, the "Add section"
  UI, and the "Adapt layout" item from the More menu. Replaced with one
  `<ObjectSections>` + one `<AdaptObjectDrawer>` in the existing action
  bar (next to the existing Edit/More controls — quote already has its
  own action-bar convention, so Adapt went there rather than via
  `PageHeader`'s `action` slot like supplier).
  **Preserved untouched:** `StatusPill`/`StatusChanger` (richer than a
  generic enum field — kept as its own dedicated UI, not folded into
  ObjectSections), the line-items table + totals, the work-orders
  section, revisions sidebar, account/contact sidebar cards, the
  copy/convert/PDF/CSV actions.
- **`src/lib/fieldRegistry.ts`** — `FIELD_REGISTRY.quote` added
  (Identity / Reference / Commercial / Sales / Notes). `status`,
  `account_id`, `contact_id`, `entity_id`, `total`, `revision`,
  `asset_ids`, `business_status`, `selected_option_id` deliberately
  excluded — each has dedicated UI elsewhere on the page, or is
  computed/internal, not a field to rename/hide/reorder.
- **Real correctness finding, not cosmetic:** `PATCH /api/quotes/[id]`
  only ever accepted `status/notes/custom_data/ref_no`. Naively pointing
  `ObjectSections` at the full header field set would have silently
  dropped every other field on save. Traced why: `discount_type`,
  `discount_pct`, `discount_fixed`, `gst_rate` feed the quote's *stored*
  `total`, which only the full `/quotations/[id]/edit` flow recalculates
  — an inline PATCH of those four would leave `total` stale. Expanded the
  whitelist to include everything **except** those four (now genuinely
  inline-editable: `name`, `type`, `valid_until`, `pr_no`, `po_number`,
  `po_amount`, `territory`, `sales_org`, `scope_of_work`, `terms`, plus
  the pre-existing `ref_no`/`notes`). The four total-affecting fields are
  `editable: false` in the registry — visible, rename/hideable, not
  inline-editable, edit-page-only, matching what's actually safe.
- **`src/app/(app)/quotations/[id]/page.tsx`** — added `getUserRole()`,
  passed `isAdmin` down.
- **Fully removed, not just unwired:** `src/app/api/layouts/[object]/route.ts`
  (whole route — defaults existed for `case`/`account`/`work_order`/
  `dashboard` too, none of which ever consumed it), `LayoutSection` /
  `PageLayout` types from `src/lib/types.ts`. Migration
  `0034_drop_page_layouts.sql` written (`DROP TABLE IF EXISTS
  page_layouts`) — **not applied**, same as every migration this
  rollout: no DB access, needs to be run manually.
- **Already consistent on the other page:** `QuoteForm.tsx` (the
  new-quote / full-edit page at `/quotations/[id]/edit`) already used
  `<AdaptObjectDrawer objectType="quote">` — nobody had ever wired it
  into the detail page. Both now point at the exact same
  `FIELD_REGISTRY.quote` config, so the Adapt experience is identical
  from either entry point, no separate work needed there.
- `tsc --noEmit` and `npm run build` both clean.

### quote — still open

- **Not verified in a browser** — same caveat as every object so far.
  Specifically worth checking: the expanded PATCH whitelist actually
  saves each newly-editable field correctly, and `total` genuinely stays
  untouched when editing a field that isn't discount/GST.
- **Migration not applied** — `page_layouts` still exists in the DB,
  just unused by the app. Harmless until run, but should be run to
  actually close this out.

---

## Phase 3 — Data Workbench rebuild

**Do not start until every row in Phase 1 (and Phase 2, once unblocked) is ✅.**

Once every object exposes the same `field-config` contract, the workbench
consumes it directly instead of a hardcoded schema:

- [ ] Delete `src/lib/import/schema.ts` (the static registry built in the
      earlier attempt) — replaced by live `field-config` reads
- [ ] Templates generated from `field-config`: tenant's actual labels,
      hidden fields excluded, real dropdown validation from `enumOptions` /
      `selectSource` — generic sample data, not Vikas's real company data
- [ ] Import: chunked submission (no single giant request — see body-size
      and duration limits noted in prior review), per-object dedupe guards
      (accounts and users had them; contacts/assets/quotes did not),
      `import_batches` record for audit + undo
- [ ] Export with filters, reusing `field_rules`' `ConditionNode` shape
      rather than inventing a new filter language
- [ ] Keep from the earlier attempt (these were sound and don't depend on
      the registry): `src/lib/import/parse.ts` (RFC-4180 + xlsx parser,
      15/15 tested), `src/lib/import/server.ts` (chunked insert, DB-error
      translation, paginated lookups), the coercion primitives in
      `src/lib/import/validate.ts`, the header-alias-matching algorithm in
      `src/lib/import/mapping.ts` (aliases become registry data, not code)

---

## Change log

- 2026-07-20 — Doc created. Decided: extend all objects to pilot parity
  before resuming Data Workbench work. Starting with `asset`.
