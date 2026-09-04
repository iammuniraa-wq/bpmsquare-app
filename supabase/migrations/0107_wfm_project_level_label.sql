-- 0107: a project's structure is named where it is created, not in settings.
--
-- Owner decision 2026-09-05, replacing the tenant-wide "project levels" list
-- added hours earlier the same day. A workspace does not have one shape: one
-- project is broken into a WBS, the next into phases, the next not at all.
-- Forcing every project through one configured ladder was the wrong model.
--
-- So the label lives on the ROW: when someone adds a part to a project they
-- say what it is ("WBS", "Phase", "Package"), and that word is used for that
-- project's parts and nowhere else. Null on a top-level project, which is
-- simply "Project".
--
-- No depth column: depth is still derived by walking parent_id, so nothing
-- has to be kept in sync. The cap is a constant in the code (see
-- projectTree.ts), not a setting -- there is nothing here a tenant benefits
-- from tuning.

alter table wfm_projects
  add column if not exists level_label text;

comment on column wfm_projects.level_label is
  'What this item is called within its parent -- WBS, Phase, Package. Null on a top-level project. Set when the item is created; siblings normally share it.';
