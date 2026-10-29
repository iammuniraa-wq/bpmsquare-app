-- KAMCO: remove ALL mail copied into the Inbox during the 2026-10-29 dry run, and reset the mailbox reader so that
-- the next read looks back 3 days and, with the channel filter on, takes in only the matching mail (the "TEST tender" email).
-- Run on KAMCO's database only. The channel's "Subject contains" filter MUST be set first (Settings > Inbox channels).
-- Deleting the emails cascades to inbound_email_attachments. Records already created from an email keep their own copies
-- of the files (record_files), so tenders made during the dry run are not affected.
--
-- ORDER: 1) pause the channel (untick "Take in new mail", Save)  2) delete the attachment files in the Storage screen (below)
--        3) run this script  4) tick "Take in new mail" again, Save  5) press "Read mail now".
-- Supabase does not allow deleting storage files with SQL (42501), so the files go through the Storage screen.

-- 1. See what will go:
select c.name, c.filter_senders, c.filter_subjects, count(e.id) as emails
from inbox_channels c
left join inbound_emails e on e.channel_id = c.id
where c.name = 'TestKamco'
group by c.name, c.filter_senders, c.filter_subjects;

-- 2. Storage screen (not SQL): Supabase dashboard > Storage > inbox-attachments > the folder named after KAMCO's tenant id
--    > inbox > select every sub-folder > Delete. The tenant id:
select t.id as tenant_id, t.name
from tenants t join inbox_channels c on c.tenant_id = t.id
where c.name = 'TestKamco';

-- 3. Delete the emails (and their attachment rows).
delete from inbound_emails
where channel_id in (select id from inbox_channels where name = 'TestKamco');

-- 4. Reset where the reader stopped for this workspace's Gmail, so the next read starts fresh (3 days back, filter applied).
delete from inbox_mailbox_state
where connector_id = 'gmail'
  and tenant_id in (select tenant_id from inbox_channels where name = 'TestKamco');

-- 5. Check: nothing left, and no saved position.
select
  (select count(*) from inbound_emails e join inbox_channels c on c.id = e.channel_id where c.name = 'TestKamco') as emails_left,
  (select count(*) from inbox_mailbox_state s where s.connector_id = 'gmail' and s.tenant_id in (select tenant_id from inbox_channels where name = 'TestKamco')) as saved_positions_left;
