-- Retires the per-section "Adapt layout" system (drag-to-reorder sections,
-- custom sections grouping custom fields). It was only ever wired up for
-- quote, and quote now uses the same FIELD_REGISTRY + field_overrides +
-- field_rules + AdaptObjectDrawer system as account/contact/asset/supplier
-- (see FIELD_REGISTRY_ROLLOUT.md). No live tenant is using page_layouts.
--
-- Application code (src/app/api/layouts/[object]/route.ts, the
-- LayoutSection/PageLayout types) was removed in the same change.

DROP TABLE IF EXISTS page_layouts;
