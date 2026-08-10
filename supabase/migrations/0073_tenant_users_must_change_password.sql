-- Admin-set passwords (initial creation via "+ Create Business User", or a
-- later "Set new password" reset) should force the recipient to choose
-- their own password on next login, instead of being usable indefinitely
-- as typed by the admin. Purely additive: defaults to false, so every
-- existing login (across every tenant) is completely unaffected until an
-- admin next sets a password through one of those two flows.

alter table tenant_users
  add column if not exists must_change_password boolean not null default false;
