-- 0236: Only take in the mail you want. A channel that reads a connected mailbox can be limited to mail from certain senders or
-- with certain words in the subject; everything else is left in the mailbox and never copied into BPMSquare.
--
--   filter_senders   an address (buyer@ministry.gov.sa) or a whole domain (@ministry.gov.sa), lower case
--   filter_subjects  words that must appear in the subject (any one is enough), lower case
--
-- Both empty = take everything (the behaviour until now). With either filled, a mail comes in when it matches a sender OR a subject word.
-- Additive, with defaults; RLS is the table's existing "inbox_channels" policy, a new column is covered by it.
--
-- Code degrades while this is pending: the channel screen shows no filter fields' saved values, and a save that includes a filter says
-- the setting cannot be stored yet; the reader takes everything, as before.

alter table inbox_channels add column if not exists filter_senders  text[] not null default '{}';
alter table inbox_channels add column if not exists filter_subjects text[] not null default '{}';
