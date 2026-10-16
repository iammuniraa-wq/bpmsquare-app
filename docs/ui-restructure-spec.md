# UI restructure — one look, one place for every button

> **Status:** spec, approved for build 2026-10-15 (owner: "except Quotation,
> everything takes the same form"). Written by Opus; implementation runs on
> Sonnet, phase by phase, from this document alone. Read
> `bpmsquarecore.md` first; nothing here relaxes it.
>
> **Build status (2026-10-16): phases 1-3 built and approved (Suppliers pilot). Phase 4 is built on `develop`, one commit per object: Products, Accounts, Contacts, Assets, Cases, Work orders, Invoices, Purchase orders, Standard Quotes, Deals, RFQs list, Inventory, Technicians, Leads, AMC, Fence projects, Marketing campaigns, Employees, and the WFM projects list shell. Not converted (own layouts, see the commit notes): the WFM project record and form, Partners (placeholder), Standard Quote templates, Marketing segments, the Fence Design Studio. Phases 5-7 are not started.**
>
> **Out of scope, untouched:** Quotations — list (`/quotations`), detail
> (`QuoteDetailLayout.tsx`), form (`quotations/new/QuoteForm.tsx`), print.
> Do not edit those files except where a shared component they already
> import changes *invisibly* (no visual change on Quotations allowed).

## 0. Why

A code audit (2026-10-15) found every object grew its own screen:

- Detail pages are built five ways — 11 of 20 use `PageHeader`; Edit lives in
  the header (Standard Quotes, Technicians), a side "actions" panel
  (Invoices, POs) or nowhere; Delete in four different places; only RFQ,
  Deal and Employee use tabs; `ObjectSections` on 10, hand-built fields on
  the rest; Nova timeline missing on Technicians; Adapt on 7 objects only.
- List pages in three states — Quotations has no search; POs and Work
  Orders no New button; Partners and Pricing no header; button wording
  varies ("+ Add Supplier" / "+ New RFQ").
- No shared Button/Input: 93 hand-copied primary buttons, 65 local button
  style objects — sizes, radius and font drift page to page.
- Settings: 18 tiles; General is ~1,900 lines mixing 8 unrelated sections;
  integrations in three places; pricing in three places; the only way
  between pages is "← Settings".
- 7 themes + 3 theme flags; every screen must work in all of them.
- Nav: Employees twice; one-item groups (Pricing, Analytics, Admin).
- Scoping: four overlapping hide layers (module flags, workcenters, nav
  visibility toggles, Business Roles) — nobody can tell why a thing is hidden.

Goals, in the owner's words: **ease of access, easy to understand, easy to
use, screens not crowded.**

## 1. Rules every screen follows (the contract)

1. **One place per action.**
   - *List page:* the only primary button is **"+ New <Object>"**, top-right
     of the page header. Bulk/secondary actions go in a "⋯" menu beside it.
   - *Record page:* top-right of the header holds **one primary action**
     (the object's next step: Send, Convert, Award, Mark won, Receive…, or
     none) and a **"⋯" More menu** that always lists, in this order and only
     when allowed: **Edit**, **Print / PDF**, **Duplicate**, divider,
     **Delete** (danger, with confirm). Nothing else hosts Edit or Delete.
   - *Forms (create/edit):* **Cancel** and **Save** bottom-right, in a sticky
     footer bar; Save is the primary. Never at the top, never inline.
   - *Cards inside a page:* at most one quiet text action in the card
     header's right corner ("Add", "Edit", "View all").
2. **Same words for same things.** "+ New <Object>", "Edit", "Delete",
   "Save", "Cancel", "Print / PDF", "⋯ More". Object names singular in
   buttons, plural in titles.
3. **Not crowded.** A record page shows ≤ 4 facts in the header strip; the
   rest goes into tabs. A list shows ≤ 7 columns by default (others behind
   the column picker if the page has one). Empty sections are hidden, not
   shown empty — except a real empty state that tells the user what to do.
4. **Readable everywhere.** Every template works at 375 px (mobile) and
   ≥ 1280 px: tables collapse to cards under 780 px (`MOBILE_BREAKPOINT`),
   the right rail stacks under the main column, the sticky form footer stays
   reachable. Both light and dark. Keyboard focus visible. No hex colours in
   components (bpmsquarecore §6) — tokens only.

## 2. Shared kit — `src/components/ui/`

New, small, token-based components. Every new/converted screen uses these;
no more local `btn`/`inp` style objects.

| Component | API (props) | Notes |
|---|---|---|
| `Button` | `variant: "primary" \| "secondary" \| "danger" \| "quiet"`, `size: "sm" \| "md"`, `href?`, `icon?`, `loading?`, native button props | One height per size (sm 30 px, md 36 px), radius from `--card-radius`-aligned token, `c.accent` for primary. Renders `<Link>` when `href`. |
| `MoreMenu` | `items: { label, onSelect?, href?, danger?, hidden?, divider? }[]` | The "⋯" menu. Keyboard + click-outside. Danger items last. |
| `Input`, `Select`, `Textarea` | native props + `invalid?` | Shared look of today's `inp`. |
| `Field` | `label`, `hint?`, `error?`, `required?`, children | Label above, hint/error below. |
| `Card` | `title?`, `action?` (ReactNode), `padding?`, children | Wraps `cardStyle`. |
| `Tabs` | `tabs: { id, label, count? }[]`, `value`, `onChange`, or URL mode `hrefFor(id)` | Underline style as on the RFQ page; scrolls horizontally on mobile. |
| `StatusPill` | `label`, `tone` | Thin wrapper over `Pill` — one place for status colour rules. |
| `EmptyState` | `title`, `text`, `action?` | Centered, used by lists and tabs. |
| `FormFooter` | `onCancel`, `saving`, `saveLabel?`, extra left slot | The sticky bottom bar. |
| `ConfirmDialog` | reuse `useFeel().confirm` | Already exists — Delete uses it everywhere. |

Rules: components take colours only from `c`/`pillar` tokens or CSS vars;
they must look right in both remaining themes (§6). Unit-test pure helpers
only; no snapshot tests.

## 3. Templates — `src/components/page/`

### 3.1 `ObjectListPage`
Server component shell; the page passes data and column defs.

```
[Title (count)]                                  [⋯] [+ New Object]
[search ……………………] [quick-filter chips …]      [Advanced filter]
┌ table (sortable headers, column search) ───────────────────────┐
│ ID │ Name (link) │ … ≤7 cols … │ Status pill │ Updated │ Open → │
└────────────────────────────────────────────────────────────────┘
[pager]                       (under 780 px: one card per row)
```
Builds on the existing `PageHeader`, `ListFilterBar`, `AdvancedFilterPanel`,
`SortableTh`, `PagerLink`, `listSort` helpers — wrap, don't rewrite.

### 3.2 `ObjectRecordPage`
```
← All <objects>
[Title]  [REF · status pill]                  [Primary action] [⋯]
[fact][fact][fact][fact]   ← header strip, ≤ 4 key facts
[ Overview | <Lines/Items> | Related | Activity ]   ← Tabs (URL ?tab=)
┌ main column (tab content) ──────────┐ ┌ right rail (260 px) ─┐
│ Overview = ObjectSections           │ │ context card(s)       │
│                                     │ │ related mini-cards    │
└─────────────────────────────────────┘ └───────────────────────┘
```
- **Overview** = `ObjectSections` (standard + custom fields, inline Edit
  toggle as today). Hand-built field blocks are replaced by the registry.
- **Lines/Items** only for objects that have lines (Standard Quotes,
  Invoices, POs, RFQs, Deals).
- **Related** = the existing related cards (cases of an account, RFQs,
  work orders…), each a `Card` with a "View all" quiet action.
- **Activity** = `NovaTimelineSlot` + change history list for the record.
- Tab state in the URL (`?tab=lines`) so links and refresh keep it.
- Edit in "⋯" opens the object's edit page (or toggles `ObjectSections`
  edit mode on Overview when the object has no separate edit page).
- "Adapt" (layout customisation) lives in "⋯" for admins on every object.

### 3.3 `ObjectFormPage` (create / edit)
Title + optional subtitle, sections as `Card`s with `Field`s,
`FormFooter` sticky at the bottom. Custom fields via `CreateExtraFields`.

## 4. Objects in scope and target shape

Order = migration order. **Pilot first (Suppliers), owner approves, then the
rest** (bpmsquarecore §10 rule 2 applies to the look, not just Nova).

| # | Object | List | Record | Primary action | Lines tab | Notes |
|---|---|---|---|---|---|---|
| 1 | **Suppliers (pilot)** | `suppliers/page.tsx` | `suppliers/[id]` | — | — | Delete moves from side panel to ⋯. RFQ track record → right rail. |
| 2 | Products | `products/page.tsx` | `products/[id]` | — | — | Cost sheet / qty breaks become Related-style cards. |
| 3 | Accounts | `accounts/page.tsx` (+`AccountsTable`) | `accounts/[id]` (`AccountHeader`, 729 lines) | Push to ERP (if on) | — | Biggest record page; split hub cards into Related tab. Account 360 button stays in header. |
| 4 | Contacts | `contacts/page.tsx` | `contacts/[id]` (`ContactHeader`, `ContactDetailSections`) | — | — | Hand-built sections → `ObjectSections`. |
| 5 | Assets | `assets/page.tsx` | `assets/[id]` (`AssetHeaderCard`) | — | — | |
| 6 | Cases | `cases/page.tsx` | `cases/[id]` (522 lines) | next status step | — | Case timeline/status board stays as Overview top block; inspection + photos → tabs. |
| 7 | Work orders | `work-orders/page.tsx` | `work-orders/[id]` | Invoice / complete | — | Add "+ New Work Order" only if a create route exists; otherwise header shows none (say so). |
| 8 | Invoices | `invoices/page.tsx` | `invoices/[id]` (`InvoiceActionsPanel`) | Send / Record payment | Lines | Actions panel dissolves into primary + ⋯. |
| 9 | Purchase orders | `purchase-orders/page.tsx` | `purchase-orders/[id]` (`PurchaseOrderActionsPanel`) | Send / Receive | Lines | Same. |
| 10 | Standard Quotes | `standard-quotes/page.tsx` | `standard-quotes/[id]` (`StandardQuoteActionsPanel`) | Send | Lines | Edit → ⋯; attachments → Related. |
| 11 | Deals | `pipeline/page.tsx` (board stays) | `pipeline/[id]` (`OpportunityDetailClient`) | Mark won / Convert | Lines | Already tabbed — align to template. |
| 12 | RFQs | `rfqs/page.tsx` | `rfqs/[id]` (`RfqDetailClient`) | Send / Award | Compare | Already tabbed — header buttons collapse into primary + ⋯. |
| 13 | Inventory | `inventory/page.tsx` | `inventory/[id]` | Adjust stock | — | |
| 14 | Technicians | `technicians/page.tsx` | `technicians/[id]` (544 lines) | — | — | Add Nova timeline (Activity). |
| 15 | Leads, Partners, AMC, Fence projects, Marketing campaigns, Employees (master data), WFM projects | their pages | where a record page exists | — | — | Lists to `ObjectListPage`; Partners/Pricing get a header. |
| — | WFM employee hub, Live board, Roster, Summary, Kiosk, My Workforce | — | — | — | — | Workforce operational screens keep their own layouts; only adopt the kit (Button/Input/Card). |
| — | **Quotations** | **unchanged** | **unchanged** | | | Out of scope (owner). |

Per object, the conversion is done when: list matches §3.1, record matches
§3.2, create/edit match §3.3, Edit/Delete only in ⋯, no local button/input
style objects left in that object's folder, mobile + desktop checked, light +
dark checked.

## 5. Settings revamp

Replace the 18-tile hub + "← Settings" with a **two-pane settings shell**:
left menu (grouped, with a search box that filters menu items by name and
keywords), right content. Mobile: menu becomes a page, content a sub-page.
Every existing settings page keeps its URL and route (no API change) — the
shell only regroups and splits.

| New group | Pages (existing route → stays) |
|---|---|
| **Company** | Company profile & workspace name (split out of General), Entities & tax, Currency (split out of General), Number ranges |
| **Users & access** | Team, Business roles (link), Navigation visibility (split out of General) |
| **Sales** | Statuses & assets, Product categories, Quote types (split out of General), Text templates, Email templates, Pricing — *Small Scale* + link to Dynamic Pricing workcenter, Coverage, RFQ |
| **Service** | (statuses/asset print fields if split), Account 360 |
| **Workforce** | Workforce (its own tabs stay) |
| **Data** | Custom fields, Deleted records |
| **Integrations** | Connectors (incl. Dynamics 365), API keys & Developer (split out of General), Webhooks / Push to external systems (split out of General), Email output (split out of General) |
| **Appearance** | Theme & colours (split out of General), Dashboard content (split out of General), Reset layout (split out of General) |

- `settings/general/page.tsx` (~1,900 lines) is split along its existing
  `Section` boundaries into the pages above — move code, don't rewrite it.
  `/settings/general` redirects to `/settings/company`.
- Feature/role gating per menu item = today's tile rules (`featureKey`,
  `featureAnyOf`, `adminOnly`, `relatedWorkcenter`) — reuse that table.
- Platform admin (`/admin/tenants/[id]` `TenantEditor`): group modules by
  the same groups, show **dependencies** ("Inventory needs Inventory &
  Purchasing"), and add a read-only **"Who sees what"** panel: pick a user →
  list which modules/workcenters/nav items they get and *which layer* hides
  each missing one (module off / role / nav visibility). Logic only reads
  existing data; no new storage.

## 6. Themes — two looks, light and dark

Keep **Classic** and **Nova** (light + dark each), plus the tenant accent
colour. Map stored values at read time (no data migration, nothing deleted):

| Stored `ui_theme` | Renders as |
|---|---|
| classic, modern | Classic |
| nextgen, nextgen2, enterprise, spectacular, spectacular_purple | Nova |

- Resolution in one function next to `useUiTheme()`; the theme picker offers
  only Classic / Nova + light/dark/system.
- Nova still requires `features.next_experience` (bpmsquarecore §10 rule 1);
  without it a stored Nova value renders Classic, as today.
- `enterprise_theme` / `spectacular_theme` flags become no-ops (left in the
  type and admin list marked "retired" until a later cleanup).
- CSS for retired looks is **not deleted in this project** — only
  unreachable. Removal is a separate, later cleanup once the owner confirms.
- **This phase changes what live tenants see** — it runs last, on the demo
  tenant first, and needs the owner's explicit go before any client tenant.

## 7. Navigation

- Groups: **Workspace** (Dashboard), **Sales & procurement**, **Service**,
  **Marketing**, **Master data**, **Workforce**, **Insights** (Analytics +
  Pricing workcenter), **Admin** (Data Workbench, Audit & Users, Settings).
- Employees appears **once** (Master data); the Workforce group keeps its
  WFM employee screen labelled "Workforce employees" only for supervisors.
- Inventory stays under Master data; its gate is shown in the admin module
  dependency list (§5) so it stops surprising people.
- Settings becomes a nav item (Admin group) in addition to the user menu.

## 8. Phases (each ends with tsc + build + tests clean, a commit on
`develop`, and a short note of what to check)

1. **Kit** — `src/components/ui/*` (§2). No screen changes yet except the
   RFQ pages adopting `Button`/`Tabs` as the proving ground.
2. **Templates** — `ObjectListPage`, `ObjectRecordPage`, `ObjectFormPage`
   (§3) + `MoreMenu`.
3. **Pilot: Suppliers** (list, record, new). **Stop for owner approval.**
4. **Objects 2–14** in the §4 order, one commit per object.
5. **Settings shell + General split + admin module dependencies + "Who sees
   what"** (§5).
6. **Navigation** (§7).
7. **Themes** (§6) — demo tenant first, owner go required.

Each phase: no new npm packages (bpmsquarecore §8); no tenant-specific code
in standard files (§1); no API/route changes beyond what a split needs;
every change keeps working while migrations are pending; Quotations
untouched. Update this document's status line per phase.

## 9. Acceptance checklist (per converted object)

- [ ] List: one "+ New" top-right; search; chips if the object has statuses;
      sortable columns; pager; card view < 780 px.
- [ ] Record: back link, title + ref + status, ≤ 4 header facts, primary
      action + ⋯ (Edit, Print/PDF, Duplicate, Delete) only; tabs with URL
      state; Overview = `ObjectSections`; Activity = timeline.
- [ ] Forms: sticky Cancel/Save bottom-right.
- [ ] No local button/input style objects left in the object's folder.
- [ ] 375 px and 1280 px, light and dark, keyboard focus visible.
- [ ] Every action still works (create, edit, delete, object-specific
      actions); permission gates unchanged (workcenter view/edit, feature).

## 10. Decisions recorded

- Quotations stay exactly as they are (owner, 2026-10-15).
- Vikas familiarity does **not** block this restructure (owner, 2026-10-15),
  but Quotations — the screen they live in — is untouched.
- Tabs on record pages: **yes** (default taken; owner may overrule after the
  pilot).
- Themes reduced to Classic + Nova (default taken; runs last, owner go
  required before any client tenant).


## 11. Settings decisions (owner, 2026-10-16)

The grouped two-pane structure in section 5 is approved (interactive mock:
claude.ai artifact "Settings Before and After"). Added requirements:

1. **Save is always top right.** Every settings page that edits values has a
   page-header action area: `Save` (disabled until something changed, with an
   "Unsaved changes" hint beside it) at the top right. No Save at the bottom,
   no per-section Save buttons, no floating save bar. The existing
   `set-savebar` in `WorkforceConfigClient` moves into this header slot.
2. **List-type settings follow the object pattern.** Team, Sites, Shifts,
   Leave types, Kiosks, Custom fields, Business roles, Text/Email templates:
   "+ New ..." (Team: "+ Invite member") top right, one row per record,
   Edit/Remove inside a "⋯" menu, create/edit in a drawer or a form page with
   the sticky Cancel/Save footer. Same kit as Suppliers (`src/components/ui`,
   `src/components/page`). Team's inline role `<select>` and red Remove
   button become the row's "⋯" menu and a role pill.
3. **Workforce is split into eight pages** under the Workforce menu group,
   in setup order, replacing the single page with five tabs and nine
   accordion sections:
   - Attendance rules (attendance rules, weekly off days, alternate Saturdays)
   - Shifts
   - Sites
   - Leave types
   - Punching & verification (punch types, verification & location)
   - Kiosks
   - Reminders & notifications (phone reminders, email notifications)
   - Employment & billing (employment types, project billing)
   Each is its own URL under `/settings/workforce/...`; `/settings/workforce`
   redirects to Attendance rules. Same fields, same API, same gating
   (`features.wfm`, admin only, project billing only with wfm_projects +
   invoices).
