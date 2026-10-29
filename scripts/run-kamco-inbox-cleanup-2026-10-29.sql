-- KAMCO: remove ALL mail copied into the Inbox from the owner's Gmail during the 2026-10-29 dry run.
-- Run on KAMCO's database only. Do it BEFORE the next deploy/read so the channel is empty when it starts reading again.
-- Deleting the emails cascades to inbound_email_attachments. Records already created from an email keep their own copies
-- of the files (record_files), so tenders made during the dry run are not affected.
-- Do NOT delete inbox_mailbox_state: it holds where the reader stopped. Without it the reader re-reads the last days of mail.
--
-- Supabase does not allow deleting storage files with SQL (42501). The attachment files go in step 3, in the Storage screen.

-- 1. See what will go:
select c.name, count(e.id) as emails
from inbox_channels c
left join inbound_emails e on e.channel_id = c.id
where c.name = 'TestKamco'
group by c.name;

-- 2. Delete the emails (and their attachment rows).
delete from inbound_emails
where channel_id in (select id from inbox_channels where name = 'TestKamco');

-- 3. Delete the attachment files (Storage screen, not SQL):
--    Supabase dashboard > Storage > inbox-attachments > the folder named after KAMCO's tenant id > inbox
--    Select every sub-folder in "inbox" and delete them. The tenant id is shown by this query:
select t.id as tenant_id, t.name
from tenants t join inbox_channels c on c.tenant_id = t.id
where c.name = 'TestKamco';

-- 4. Check it is empty:
select count(*) as emails_left
from inbound_emails e join inbox_channels c on c.id = e.channel_id
where c.name = 'TestKamco';
