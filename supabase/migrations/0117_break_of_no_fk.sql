-- Sales Engine Piece A follow-up to 0116. break_of was created as a
-- self-referencing foreign key (uuid references standard_quote_lines(id)).
-- Both quote objects save their lines by deleting every existing row and
-- re-inserting the whole set on every save (see api/standard-quotes/[id]
-- and api/quotes/[id]/edit) -- a brand-new quantity break and its parent
-- line are always created in the very SAME insert, so neither the client
-- nor the server can know the parent's real row id before the statement
-- runs. A hard FK here is unusable, not just fragile.
--
-- group_id already solves the identical problem the right way: it is a
-- plain, unconstrained tag, and application code -- never the database --
-- is responsible for a foreign id from the request body resolving to
-- something real and tenant-owned (MULTI_TENANT_GUARDRAILS.md). break_of
-- becomes the same kind of tag: the server resolves it to the row it
-- actually just assigned, scoped to the exact batch of lines in that one
-- request, before ever writing it.

alter table standard_quote_lines drop constraint if exists standard_quote_lines_break_of_fkey;
alter table quote_lines drop constraint if exists quote_lines_break_of_fkey;

alter table standard_quote_lines alter column break_of type text using break_of::text;
alter table quote_lines alter column break_of type text using break_of::text;
