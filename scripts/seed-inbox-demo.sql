-- Shared Inbox: demo switch, two channels and five sample emails for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0214_inbox.sql (scripts/run-bundle-23-inbox-2026-10-24.sql).
-- Idempotent. Touches ONLY tenants where is_demo = true; never a client.
--
-- It switches the `inbox` flag on, adds two channels (Fence enquiries, Tiles and flooring) and five customer emails:
--   1. a fence request with a PDF and a DXF (both "Good"),
--   2. a photo-only message (one image, "Needs review"),
--   3. a DWG-only message (one file, "Poor": ask for a DXF),
--   4. a tiles request with a floor-plan PDF,
--   5. a handled conversation with our reply, to show a thread.
-- The sample files are LABELS only: the attachment rows point at paths that hold no file, so opening one says "not found".
-- To see a real file, forward a real email to a channel's address (Settings > Integrations > Inbox channels).
-- The sample bodies are stored as plain text; mail that really arrives is encrypted by the application. Sample
-- addresses end in .example and a demo workspace never sends a reply to a customer (it is redirected).

update tenants
   set features = coalesce(features, '{}'::jsonb) || '{"inbox": true}'::jsonb
 where is_demo = true
   and coalesce((features ->> 'inbox')::boolean, false) = false;

-- Channels. The address key is derived from the tenant id, so a second run finds the same rows.
insert into inbox_channels (tenant_id, name, address_alias, default_action, active)
select t.id, 'Fence enquiries', 'inbox-' || substr(translate(md5(t.id::text || ':fence'), '01', '23'), 1, 16), 'quote', true
  from tenants t
 where t.is_demo = true
on conflict do nothing;

insert into inbox_channels (tenant_id, name, address_alias, default_action, active)
select t.id, 'Tiles and flooring', 'inbox-' || substr(translate(md5(t.id::text || ':tiles'), '01', '23'), 1, 16), 'estimate', true
  from tenants t
 where t.is_demo = true
on conflict do nothing;

-- 1. Fence request with a PDF and a DXF
insert into inbound_emails (tenant_id, channel_id, direction, provider, provider_message_id, message_id, thread_key, from_address, from_name,
                            to_addresses, subject, body_text, snippet, received_at, status, expires_at)
select t.id, c.id, 'in', 'seed', 'seed:fence-1', 'seed-fence-1@customer.example', 'm:seed-fence-1@customer.example',
       'procurement@dammam-build.example', 'Khalid Al-Harbi', array['enquiries@demo.example'],
       'Quote for 320 m chain-link fence, Dammam site',
       E'Hello,\n\nWe need a price for about 320 m of galvanised chain-link fence, 2.4 m high, with two 4 m double gates, around our new yard in Dammam.\nThe boundary drawing is attached as a PDF and a DXF. We would like delivery and installation within six weeks.\n\nBest regards,\nKhalid Al-Harbi\nDammam Build Co.',
       'We need a price for about 320 m of galvanised chain-link fence, 2.4 m high, with two 4 m double gates, around our new yard in Dammam.',
       now() - interval '3 hours', 'new', now() - interval '3 hours' + interval '90 days'
  from tenants t
  join inbox_channels c on c.tenant_id = t.id and c.address_alias = 'inbox-' || substr(translate(md5(t.id::text || ':fence'), '01', '23'), 1, 16)
 where t.is_demo = true
on conflict do nothing;

-- 2. Photo only
insert into inbound_emails (tenant_id, channel_id, direction, provider, provider_message_id, message_id, thread_key, from_address, from_name,
                            to_addresses, subject, body_text, snippet, received_at, status, expires_at)
select t.id, c.id, 'in', 'seed', 'seed:fence-2', 'seed-fence-2@customer.example', 'm:seed-fence-2@customer.example',
       'm.farah@gmail.example', 'Mona Farah', array['enquiries@demo.example'],
       'Fence repair - photo of the damage',
       E'Hi, part of our fence blew down in the storm. Photo attached. Can you give me a price to fix it?\n\nMona',
       'Hi, part of our fence blew down in the storm. Photo attached. Can you give me a price to fix it?',
       now() - interval '1 day', 'new', now() - interval '1 day' + interval '90 days'
  from tenants t
  join inbox_channels c on c.tenant_id = t.id and c.address_alias = 'inbox-' || substr(translate(md5(t.id::text || ':fence'), '01', '23'), 1, 16)
 where t.is_demo = true
on conflict do nothing;

-- 3. DWG only
insert into inbound_emails (tenant_id, channel_id, direction, provider, provider_message_id, message_id, thread_key, from_address, from_name,
                            to_addresses, subject, body_text, snippet, received_at, status, expires_at)
select t.id, c.id, 'in', 'seed', 'seed:fence-3', 'seed-fence-3@customer.example', 'm:seed-fence-3@customer.example',
       'site.engineer@al-noor-dev.example', 'Omar Siddiqui', array['enquiries@demo.example'],
       'Plot plan for fencing (DWG)',
       E'Dear team,\n\nPlease find our plot plan attached. We need the perimeter fenced and a sliding gate on the north side.\n\nRegards,\nOmar Siddiqui\nAl Noor Developments',
       'Please find our plot plan attached. We need the perimeter fenced and a sliding gate on the north side.',
       now() - interval '2 days', 'new', now() - interval '2 days' + interval '90 days'
  from tenants t
  join inbox_channels c on c.tenant_id = t.id and c.address_alias = 'inbox-' || substr(translate(md5(t.id::text || ':fence'), '01', '23'), 1, 16)
 where t.is_demo = true
on conflict do nothing;

-- 4. Tiles request
insert into inbound_emails (tenant_id, channel_id, direction, provider, provider_message_id, message_id, thread_key, from_address, from_name,
                            to_addresses, subject, body_text, snippet, received_at, status, expires_at)
select t.id, c.id, 'in', 'seed', 'seed:tiles-1', 'seed-tiles-1@customer.example', 'm:seed-tiles-1@customer.example',
       'projects@oasis-retail.example', 'Layla Haddad', array['tiles@demo.example'],
       'Floor tiles for a 120 m2 showroom',
       E'Hello,\n\nWe are fitting out a 120 m2 showroom and want 60x60 cm porcelain floor tiles in light grey, laid straight. The floor plan is attached.\nCould you send an estimate including laying?\n\nThanks,\nLayla Haddad\nOasis Retail',
       'We are fitting out a 120 m2 showroom and want 60x60 cm porcelain floor tiles in light grey, laid straight.',
       now() - interval '5 hours', 'new', now() - interval '5 hours' + interval '90 days'
  from tenants t
  join inbox_channels c on c.tenant_id = t.id and c.address_alias = 'inbox-' || substr(translate(md5(t.id::text || ':tiles'), '01', '23'), 1, 16)
 where t.is_demo = true
on conflict do nothing;

-- 5. A handled conversation: the customer's question and our reply
insert into inbound_emails (tenant_id, channel_id, direction, provider, provider_message_id, message_id, thread_key, from_address, from_name,
                            to_addresses, subject, body_text, snippet, received_at, status, handled_at, expires_at, read_at)
select t.id, c.id, 'in', 'seed', 'seed:tiles-2', 'seed-tiles-2@customer.example', 'm:seed-tiles-2@customer.example',
       'accounts@harbour-hotel.example', 'Nadia Rahman', array['tiles@demo.example'],
       'Sample tiles for the lobby',
       E'Can you post two sample tiles of the beige marble effect to our site office? We will decide next week.\n\nNadia',
       'Can you post two sample tiles of the beige marble effect to our site office?',
       now() - interval '4 days', 'handled', now() - interval '3 days', now() - interval '4 days' + interval '90 days', now() - interval '3 days'
  from tenants t
  join inbox_channels c on c.tenant_id = t.id and c.address_alias = 'inbox-' || substr(translate(md5(t.id::text || ':tiles'), '01', '23'), 1, 16)
 where t.is_demo = true
on conflict do nothing;

insert into inbound_emails (tenant_id, channel_id, direction, provider, provider_message_id, message_id, in_reply_to, thread_key, from_address, from_name,
                            to_addresses, subject, body_text, snippet, received_at, status, send_status, expires_at)
select t.id, c.id, 'out', 'platform', 'seed:tiles-2-reply', 'seed-tiles-2-reply@bpmsquare.example', 'seed-tiles-2@customer.example', 'm:seed-tiles-2@customer.example',
       'tiles@bpmsquare.example', 'Tiles and flooring', array['accounts@harbour-hotel.example'],
       'Re: Sample tiles for the lobby',
       E'Hello Nadia,\n\nYes, two samples of the beige marble effect go out by courier today. You will have them within two working days.\n\nKind regards,\nTiles and flooring',
       'Yes, two samples of the beige marble effect go out by courier today.',
       now() - interval '3 days', 'handled', 'sent', now() - interval '4 days' + interval '90 days'
  from tenants t
  join inbox_channels c on c.tenant_id = t.id and c.address_alias = 'inbox-' || substr(translate(md5(t.id::text || ':tiles'), '01', '23'), 1, 16)
 where t.is_demo = true
on conflict do nothing;

-- The sample files (labels only; see the header).
insert into inbound_email_attachments (tenant_id, email_id, file_name, storage_path, mime_type, ext, size_bytes, quality, quality_note)
select e.tenant_id, e.id, f.file_name, e.tenant_id::text || '/inbox/' || e.id::text || '/seed-' || f.file_name, f.mime_type, f.ext, f.size_bytes, f.quality, f.note
  from inbound_emails e
  join tenants t on t.id = e.tenant_id and t.is_demo = true
  join (values
    ('seed:fence-1', 'site-boundary.pdf', 'application/pdf', 'pdf', 421000, 'good', null),
    ('seed:fence-1', 'boundary.dxf', 'image/vnd.dxf', 'dxf', 88000, 'good', null),
    ('seed:fence-2', 'IMG_2041.jpg', 'image/jpeg', 'jpg', 180000, 'review', 'A photo or scan can only be read as far as it is clear. Ask for a PDF or DXF if details are missing.'),
    ('seed:fence-3', 'plot-plan.dwg', 'image/vnd.dwg', 'dwg', 1350000, 'poor', 'A DWG cannot be read here. Ask the customer to save a DXF or PDF.'),
    ('seed:tiles-1', 'floor-plan.pdf', 'application/pdf', 'pdf', 265000, 'good', null)
  ) as f(pmid, file_name, mime_type, ext, size_bytes, quality, note) on f.pmid = e.provider_message_id
 where e.provider = 'seed'
   and not exists (select 1 from inbound_email_attachments a where a.email_id = e.id and a.file_name = f.file_name);
