# Rich UI, calm and large (design, 2026-11-05)

> Owner brief: "bright 4K clarity, nice font, good interactive images, clean, not messy, not too much text."
> Reference feel: askdonna.com (calm, premium, one idea per screen). Feel only, not layout or content.
> Clickable mock-up: `docs/design/rich-ui-mockup.html` (Dashboard, Accounts, Account record; light and dark; 1440 px and 375 px).
> No application code written. Rules 6b, 6c and 3c of `bpmsquarecore.md` still apply.

## What is already there
- `src/app/globals.css`: base tokens (`--panel`, `--line`, `--accent`, 12 px card radius) plus the `[data-theme="nextgen"]` layer.
  `nextgen2` is folded into `nextgen` by `uiTheme`; `[data-nova="true"]` (set by `Shell.tsx` when `useIsNextgen3Layer()` is true) layers the dark-only Nova tokens on top.
- Gate: `features.next_experience` (platform-admin only, default off) plus the tenant picking Nova in Settings, Appearance. Nothing experimental reaches a client without it.
- `src/components/ui`: `Card`, `StatTile`, `StatusPill`, `Tabs`/`useUrlTab`, `InfoTip`, `SidePanel`, `EmptyState`, `Button`. All reusable; this proposal re-skins them, it does not replace them.
- `docs/design/ux-simplification.md` already removes hint lines (InfoTip) and splits big pages into tabs. This note builds on it and goes further on visual weight.
- Gap: Nova is dark-only and still uses bordered cards and small captions. There is no light Nova, no imagery, no motion language.

## Type scale (Poppins headings, Inter body)
Display (KPI numbers) 32 to 44 px, H1 36 to 60 px, H2 28, H3 20, body 16, small 14. Nothing under 14 px, no uppercase micro-captions. Numbers use tabular figures.

## Spacing and shape
Spacing 4, 8, 12, 16, 24, 32, 48, 72, 112. Radii 16 (controls), 24 (cards), 32 (heroes), pill (buttons, search, status). Shadows replace borders; the only line is one hairline (tab strip, table rows, sticky bar).

## Colour tokens (all on `:root` and `[data-theme="dark"]`, none in components)
`canvas`, `surface`, `surface-2`, `ink`, `ink-2`, `ink-3`, `hair`; one accent `violet` (+ `violet-2`, `violet-soft`, `violet-ink`, `on-violet`); one alert accent `warm` (+ soft, ink); `good`; four stage shades `st1..st4`; five mesh stops `m0..m4`; `glass`, `shadow-1..3`, `focus`. Text pairs checked for AA in both modes. Tenant `accent_color` maps to `violet` in the real build.

## Six principles
1. One idea per screen; one sentence of copy at most.
2. Big numbers, big type, whitespace instead of boxes.
3. Imagery in rounded frames (gradient "photo" stand-ins now; tenant or customer images later), small glass cards floating over them.
4. Rings and bars carry state; labels carry names, never paragraphs.
5. Detail sits behind expanders and tabs; the list never starts as a spreadsheet.
6. Motion explains (count-up, slide between screens, hover lift) and stops under `prefers-reduced-motion`.

## What each screen replaces
- **Dashboard**: StatTile grid and bordered widgets become four large numbers, one hoverable pipeline flow, a three-item attention strip and three bid cards with a progress ring.
- **Accounts**: the dense table with an "Open" button per row becomes Rows (default), Cards or Table. Whole row opens; call, email and quote appear on hover. The Table view stays one click away.
- **Account record**: stacked field cards become a hero, health ring, pipeline, cases, a five-event touch timeline, tabs and collapsed sections. "Ask Nova" shows the next best step (score stays rubric-based, per 10a).

## Proposed rollout
1. New token layer `[data-nova="rich"]` in a separate stylesheet, loaded only when `next_experience` is on; same gate as 10 of the core doc.
2. Demo tenant only. Build order: tokens and shell rail, Dashboard, Accounts (Rows/Cards, Table kept), Account record. Owner validates each before the next (rule 2 of Nova).
3. Reuse `Tabs`, `StatusPill`, `InfoTip`; add `Ring`, `Sparkline`, `PhotoFrame`, `CountUp` to `src/components/ui`.
4. Check 375 px and PC, light and dark, then decide on a client tenant. Live clients are untouched until then.
5. Open question: is the left icon rail the new global nav, or does Nova keep its current chrome with only the content re-skinned?

## Implementation (step 1, foundation, 2026-11-05)
Branch `rich-ui`. UI only: no data, API or SQL. Dashboard, Accounts and Account record are not re-laid-out yet; this step gives every screen the new tokens, type and shapes, and adds the building blocks.

**The gate.** Rich renders only when all three hold: `ui_theme` is `nextgen2`, `features.next_experience` is on (platform admin), and `config.appearance.rich_ui` is `true`. One function decides it, `isRichTenant()` in `src/lib/nova/isNovaTenant.ts`; the client hook is `useRichUi()` in `src/lib/tenant-context.tsx`. Shell stamps `data-rich="true"` and `data-rich-nav="menu|rail"` on both wrapper divs, and mirrors `data-rich-root` / `data-rich-dark` onto `<html>` (`src/lib/richUi.ts`) so toasts, the confirm dialog and the InfoTip popover, which render outside the wrapper, follow too.

**Switch it on for a tenant.** 1) Platform admin: `/admin/tenants`, turn `next_experience` on. 2) Workspace admin: Settings, Appearance, Theme: choose Nova, then switch "Rich look" on and Save (the page reloads). The switch is offered only on Nova with the flag. Off again removes the key. Nothing else changes for any other tenant.

**Files.**
- `src/styles/rich.css`, imported once in `src/app/layout.tsx` after `globals.css`. Every selector starts with `[data-rich="true"]` or `html[data-rich-root="true"]`; Poppins (`public/fonts/poppins-latin-500/600/700.woff2`) is declared with a plain `@font-face`, `font-display: swap`, so nothing downloads for other tenants. Inter is the app's existing self-hosted face.
- `src/components/RichRail.tsx`, `RichNavToggle.tsx`; `Shell.tsx` (stamps, Menu/Rail, light mode for Rich, avatar in the phone top bar); `MobileTabBar.tsx` and `ui/SidePanel.tsx` gained class and data hooks only.
- `src/components/ui/Ring.tsx`, `Sparkline.tsx`, `CountUp.tsx`, `PhotoFrame.tsx`, each with a `*.render.test.ts`.
- Appearance: `rich` in `appearanceLogic.ts`, the row in `ThemeTab.tsx`, tip in `settingsTips.ts`, tests in `appearance.test.ts`. `rich_ui` added to `TenantConfig.appearance`.
- Class hooks added to `Pill` (`bpm-pill`), `StatTile` (`bpm-stat`), `Card` (`bpm-card`), `EmptyState` (`bpm-empty`), `Pager`/`PagerLink` (`bpm-pager`).

**Tokens.** `--rich-*` set from the mock-up, light and dark: `canvas`, `surface`, `surface-2`, `ink`, `ink-2`, `ink-3`, `hair`; accent `violet` (= the tenant `accent_color` via `--tenant-accent`) with `strong`, `2`, `soft`, `ink`, `on-violet`, `btn`; `warm`, `good` (+ soft, ink); `glass`, `canvas-glass`, `scrim`, `shadow-1..3`, `st1..st4`, `m0..m4`. They are then mapped onto the app's own variables (`--panel`, `--panel2`, `--card-bg`, `--ink`, `--muted`, `--line`, `--accent`, `--modern-accent`, `--card-radius: 24px`, `--card-shadow`, `--surface-*`, `--sb-*`, `--drawer-*`, and Nova's `--nova-*`), so existing components follow without edits. Shapes 16 / 24 / 32 px and pill; shadows replace borders.

**Navigation.** "Menu" is the existing NovaSidebar re-skinned (glass, rounded, calm command bar). "Rail" is the floating icon rail with hover and focus names and a flyout for categories with several modules; it lists the same Spaces as the menu and the phone tab bar, so every item stays reachable. The Needs you now / Flows panels live in Menu only. The choice is per browser (`bpm-rich-nav`); the toggle is hidden under 900 px.

**Phone (under 900 px).** One column, 16 px gutters, 44 px minimum targets, no sideways page scroll. Floating glass pill tab bar (28 px radius, safe-area aware, violet dot on the active item); the top bar is logo, search, bell and avatar (hamburger hidden, the tab bar's More opens the drawer); the side panel is a bottom sheet with a grab handle and 32 px top corners; the Ctrl K palette is a full-screen pill overlay; press states scale to .97 with soft spring transitions. Everything animated stops under `prefers-reduced-motion`.

**Not done in step 1.** Screen layouts (Dashboard, Accounts rows/cards, Account record), per-screen fixes for components that hard-code dark colours, and the Drive guide (no user-visible change for any tenant until the flag is on). Needs a live look on the demo tenant at 375 px and PC, light and dark.
