-- 0071_quote_version_lock.sql
-- Quote versioning could previously only be started once a quote reached a
-- closed status (Approved/Rejected) -- Draft/Sent quotes had no "create new
-- version" path at all, only in-place edit. That's being relaxed to allow
-- starting a new version from any phase, which means the OLD version now
-- needs an explicit lock: without one, a superseded Draft/Sent quote would
-- stay fully editable forever, with two "live" copies of the same quote
-- diverging silently.
--
-- superseded_by is null for the current/latest version in a revision chain,
-- and points at whichever quote replaced it once a new version is created.
-- `on delete set null` rather than cascade -- deleting a newer version
-- should reopen the older one, not cascade-delete the whole chain.
alter table quotes add column superseded_by uuid references quotes(id) on delete set null;

create index quotes_superseded_by_idx on quotes (superseded_by) where superseded_by is not null;
