# Message monitor: one page for every message in and out

Status: proposal 2026-10-21, not built. Owner request: "a message monitor page
to see all incoming and outgoing messages."

## What exists today (nothing shows it in one place)

| Channel | Direction | Where it is recorded | Page today |
|---|---|---|---|
| Email (quotes, campaigns) | out | `email_log` (to, subject, status, error, record) | Administration, Outbound emails |
| Email delivery events | in (provider) | `email_provider_events` (delivered, bounced) | none |
| RFQ mail and portal | in and out | `rfq_messages` (direction, channel, subject, status) | inside each RFQ |
| WhatsApp | in and out | `whatsapp_messages` (encrypted body and number) | inside the record |
| Webhooks | out | `webhook_deliveries` (status, error, duration) | Settings, Webhooks and push |
| Connectors (Dynamics) | in (pull) and out (push) | `connector_sync_runs` (counts, error) | Connector screen, Recent runs |
| REST API v1 | in | **not logged** | none |
| Inbound email / WhatsApp routes | in | only what the RFQ or WhatsApp tables keep | none |

Gaps: API calls and connector request detail are not recorded at all.

## Proposal

**Page:** Administration, **Message monitor**. Admin only, behind a flag
(default off, on for demo tenants). One list, newest first.

Columns: time, direction (in / out), channel (email, WhatsApp, webhook,
connector, API), counterpart, summary, status (ok, failed, redirected,
dry run), related record (link), duration. Filters: direction, channel,
status, date, record. Click a row for a side panel: headers, error text,
related record, and the body or payload for those who may see it.

**S1, read-only, no schema change:** a server query that unions the five
sources above, always `tenant_id`-filtered. Ships the page and the filters.
**S2, close the gaps:** a new `integration_messages` table written by the v1
API and the connector client: method, path or entity, status, duration, size,
a correlation id that ties a connector run to its rows. Metadata only by
default; payload capture is a per-workspace switch with redaction and 30-day
retention. **S3, act on failures:** retry for failed webhooks and failed
connector runs, with the same locks the sync already uses.

## Rules that apply
- Personal data: email and WhatsApp bodies and phone numbers are encrypted;
  the list shows metadata only, the body opens on demand, admin only, and
  every open is itself change-logged.
- Demo workspaces: show the "redirected to" address so nobody thinks a demo
  mail reached a customer (email-output safeguard).
- Every query uses `requireTenantUser()` and `.eq("tenant_id", tenantId)`.
- Surfaces (bpmsquarecore 3b): Settings menu entry, workcenter key, flag in
  TenantFeatures / TenantEditor / NewTenantForm, Cmd+K entry, Nova assistant
  tool ("did the email to X go out?"), read-only `GET /api/v1/messages` and
  OpenAPI, guide update after the owner validates.

## Decisions for the owner
1. Start with S1 (existing sources only)? Recommended: yes, then S2.
2. Record API and connector payloads, or metadata only? Recommended:
   metadata only, payload capture off by default.
3. Admin only, or also Business Roles that hold a new "Messages" workcenter?
