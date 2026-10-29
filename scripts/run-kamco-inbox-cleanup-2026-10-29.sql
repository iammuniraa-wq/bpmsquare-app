-- KAMCO: remove the mail copied into the Inbox from the owner's Gmail during the 2026-10-29 dry run,
-- KEEPING only the dry-run test email(s) whose subject starts with "TEST tender".
-- Run on KAMCO's database only, AFTER the test email has arrived and the TestKamco channel is paused
-- (Settings > Inbox channels > untick "Take in new mail"), so nothing is copied in again.
-- Deleting emails cascades to inbound_email_attachments. Records already created from an email keep their own copies
-- of the files (record_files), so tenders made during the dry run are not affected.
--
-- To remove EVERYTHING including the test email, delete the line "and subject not ilike 'TEST tender%'" in steps 2 and 3.

-- 1. See what will go and what stays (check the numbers before running the rest):
select c.name,
       count(e.id) filter (where e.subject not ilike 'TEST tender%') as to_delete,
       count(e.id) filter (where e.subject ilike 'TEST tender%')     as kept
from inbox_channels c
left join inbound_emails e on e.channel_id = c.id
where c.name = 'TestKamco'
group by c.name;

-- 2. Delete the attachment files of the emails that go, from the private bucket.
delete from storage.objects
where bucket_id = 'inbox-attachments'
  and name in (
    select a.storage_path
    from inbound_email_attachments a
    join inbound_emails e on e.id = a.email_id
    join inbox_channels c on c.id = e.channel_id
    where c.name = 'TestKamco'
      and e.subject not ilike 'TEST tender%'
  );

-- 3. Delete those emails (and their attachment rows).
delete from inbound_emails
where channel_id in (select id from inbox_channels where name = 'TestKamco')
  and subject not ilike 'TEST tender%';

-- 4. Check: only the test email is left.
select e.from_address, e.subject, e.received_at
from inbound_emails e join inbox_channels c on c.id = e.channel_id
where c.name = 'TestKamco'
order by e.received_at desc;
