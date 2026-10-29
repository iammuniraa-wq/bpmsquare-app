-- KAMCO: remove the mail copied into the Inbox from the owner's Gmail during the 2026-10-29 dry run.
-- Run on KAMCO's database only, AFTER pausing the TestKamco channel (Settings > Inbox channels) so nothing is re-imported.
-- Deleting the emails cascades to inbound_email_attachments. Records already created from an email keep their own copies
-- of the files (record_files), so tenders made during the dry run are not affected.

-- 1. See what will go (check the count and the channel):
select c.id as channel_id, c.name, count(e.id) as emails
from inbox_channels c
left join inbound_emails e on e.channel_id = c.id
where c.name = 'TestKamco'
group by c.id, c.name;

-- 2. Delete the attachment files from the private bucket.
delete from storage.objects
where bucket_id = 'inbox-attachments'
  and name in (
    select a.storage_path
    from inbound_email_attachments a
    join inbound_emails e on e.id = a.email_id
    join inbox_channels c on c.id = e.channel_id
    where c.name = 'TestKamco'
  );

-- 3. Delete the emails (and their attachment rows).
delete from inbound_emails
where channel_id in (select id from inbox_channels where name = 'TestKamco');

-- 4. Optional: forget where the mailbox reader stopped, so a later connected mailbox starts clean.
-- delete from inbox_mailbox_state where connector_id = 'gmail';

-- 5. Check it is empty:
select count(*) as emails_left
from inbound_emails e join inbox_channels c on c.id = e.channel_id
where c.name = 'TestKamco';
