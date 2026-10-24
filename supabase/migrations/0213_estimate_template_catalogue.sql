-- 0213: Estimate template catalogue (docs/design/estimator-unification-and-inbox.md,
-- docs/estimator-architecture.md section 18).
--
-- A template is now something a person PICKS from a card ("What are you estimating?")
-- and something the AI can pick from an email, so it carries a plain description, the
-- words an email would use for it (keywords), an icon, and two switches:
--
--   locked            a starter template installed by the product. It cannot be edited;
--                     a workspace changes it with "Copy to customise", which makes an
--                     editable, unlocked copy. (Enforced in the API, not by the database.)
--   customer_visible  reserved for the later customer self-serve "Request an estimate"
--                     page; nothing reads it yet and staff-only is the default.
--
-- All additive. `description` already exists (0131); the line is kept so this file is the
-- whole story and is safe to run on a database where it was dropped by hand.
-- RLS: the table already has its tenant-isolation policy (0131); nothing changes there.
--
-- Code degrades while this is pending: the New estimate cards show every active template
-- with a default icon, "Copy to customise" is hidden, and templates are editable as before.

alter table estimate_templates add column if not exists description text;
alter table estimate_templates add column if not exists keywords text[];
alter table estimate_templates add column if not exists icon text;
alter table estimate_templates add column if not exists locked boolean not null default false;
alter table estimate_templates add column if not exists customer_visible boolean not null default false;
