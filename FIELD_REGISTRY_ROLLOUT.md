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
| asset | ✅ | ✅ | ✅ | ✅ (code, untested in browser) | ✅ | ✅ | ⬜ manual check | ⬜ manual check | ✅ typecheck+build clean | ✅ | 🟡 Code complete, manual UI check pending |
| supplier | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🔲 Not started |
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

### asset — still open

- **Decision B** (is_loaner/loaner_status): left out of the registry as
  agreed — no live workflow sets `loaner_status: "on_loan"` anywhere outside
  seed data, so no editability was added for it.
- **`frame_size`/`insulation` vs `frame_type`/`insulation_class`**: not
  reconciled (see extension note above) — low priority, `extraCustomFields`
  is still dead code (never invoked anywhere).
- **Not verified in a browser** — no working localhost auth session this
  session (dev magic-link redirects to production). Checklist items 7
  (overrides) and 8 (rule fires correctly) are implemented per the same
  code path account/contact already use, but not clicked through manually.
  Do this before treating asset as fully ✅.
- **Migration not applied** — see above. Nothing nameplate-related will
  actually persist/display until it's run.

---

## Phase 2 — line-item objects (blocked on Decision A)

| Object | 1. Registry entry | 2. Pilot type | 3. field-config merges | 4. Adapt + rules | 5. ObjectSections | 6. Old wiring removed | 7. Overrides verified | 8. Rule verified | 9. No regressions | 10. Extension conflicts checked | **Status** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| quote | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🔲 Blocked on Decision A |
| invoice | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🔲 Blocked on Decision A |
| purchase_order | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🔲 Blocked on Decision A |
| inventory | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 🔲 Blocked on Decision A |

Order: settle Decision A first, then quote → invoice → purchase_order → inventory
(quote first — most complex, so its shape informs the other three).

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
