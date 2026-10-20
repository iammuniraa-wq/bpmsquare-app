# WhatsApp marketing, the shell (phase M6 of the marketing platform)

> Written 2026-10-20 with the code. A shell is a thin, working, demo-able slice on a solid foundation
> (tables, row security, flag, events, the consent gate) with the rich features left for later. Design source:
> `docs/marketing-platform-architecture.md` sections 7, 1.3 and 3.2. Flag: `features.whatsapp_marketing`,
> platform-admin only, default off, needs `marketing`. **The provider is not chosen yet**; nothing in the shell
> calls any outside service.

## Built in the shell

**The provider seam.** `src/lib/marketing/whatsapp/provider.ts` is the one interface a provider plugs into
(`sendTemplate`, `sendSession`, `verifyWebhook`, `parseWebhook`, the credential fields it needs). The only
adapter is the **sandbox**: a send returns at once and the message is logged as a dry run; its webhook is a plain
signed JSON format so the whole inbound path can be exercised with curl. The file's header lists the three steps to
add Meta Cloud API, Twilio or a GCC business solution provider. Nothing outside the folder knows how any provider
works; a test fails the build if the file ever makes a network call.

**The template object** (`whatsapp_templates`, WAT-####): name, language, category (marketing, utility,
authentication), a body with named details (`{{contact_name}}`, `{{company_name}}`, `{{account_name}}`,
`{{quote_ref}}`, `{{amount}}` from a closed list), the consent subject, the name at the provider, and a status
(draft, approved, rejected, archived). In the shell the approval is **a person's flag** (admin only); changing the
words of an approved template sends it back to draft, as a provider would make you re-submit. The body is checked
against the rules WhatsApp enforces (not empty, 1024 characters, only known details, not starting or ending with
a detail, no two details side by side). The provider's positional `{{1}}, {{2}}` order is computed from the body.
List (`/marketing/whatsapp`) on the shared list template; editor in the studio layout (options on the left in
collapsible groups with a one-line hint each, the message as a bubble on the right, optional English "Show me
how", the panel above on a phone). Select-only row security: the approval flag decides what may be sent.

**The number and secrets** (`whatsapp_identities`, one per workspace). The business number and every credential are
encrypted with the same AES-256-GCM as contact phones, like `tenant_connectors`; nothing secret is in
`tenants.config`. The table has **no row-security policy at all**, so only the service-role client can read it,
after an admin check; the number comes back masked and no credential value is ever returned. The inbound address
(`/api/inbound/whatsapp/<random key>`) and a signing secret (shown once, can be remade) are on **Marketing,
WhatsApp, Number and messages**, together with the recent message log.

**The one send function** (`sendWhatsAppTemplate`). A person on the template page ("Send it to one person") and a
journey step both go through it, so neither can bypass a rule:
1. the workspace must own the module;
2. `canContact(whatsapp, the template's subject)` is asked **first, at the moment of sending**, before anything
   else is looked at, so a refusal is never hidden behind a setup problem. The consent ledger's channel
   `whatsapp` already existed; the contact's Consent card already records it;
3. the template must be approved (`sendRule`): a template can go any time, free text only inside the 24 hours after
   the person's last message AND only from a person, never a journey (the rule is code and tested; the shell has no
   free-text screen yet);
4. a marketing template is limited to one per person per 7 days (`config.whatsapp.weekly_cap`, 1 to 20);
5. a demo workspace never reaches a real number: it goes to `config.whatsapp.redirect_number` or is only logged;
6. the message row is written **before** the provider is called and a repeated `client_ref` finds that row, so a
   retried tick cannot send twice; a failed row is retried on the same row;
7. `whatsapp.sent` or `whatsapp.failed` (a new catalogue name) is emitted with ids and short codes only, never the
   text or the number.
Message text and the number are stored encrypted. Phone numbers are normalised to `+<code><number>`; a number that
would have to be guessed (no `+`, no `00`, no known country) is refused with "no usable phone".

**Inbound** (`POST /api/inbound/whatsapp/<key>`, `handleInbound`). The tenant is the stored identity row the key
names, **never** the body. Order: size cap, find the row (404 for an unknown key, a disabled number or a workspace
without the module), then the provider's signature is verified over the **raw** body, then the body is parsed.
Status callbacks move one of our messages forward (sent, delivered, read; a delivered message never "fails"),
emitting `whatsapp.delivered` / `whatsapp.read` / `whatsapp.failed`. A message from a number we hold a hash for is
stored and becomes `whatsapp.replied` (ABM progress and the lead score already read that event). A message that is
only STOP (or the Arabic words) writes a **withdrawal to the consent ledger** (source `provider_webhook`) and emits
`whatsapp.opted_out`; START records the opt-in again; "can you stop by tomorrow" is a reply. A number we cannot match
creates nothing: no contact, no message, no event. Replays are no-ops (a check plus a unique index).

**Number matching.** Contact phones are encrypted with a random IV, so nothing can look a contact up by phone. A
keyed hash (HMAC with its own label, derived from the existing key) is kept in `whatsapp_numbers` when a message is
sent and by **Match my contacts' numbers** (admin, slices of 500 by id), so a START from someone never messaged can
still be matched. Never shown, exported or returned by any API.

**The journey step.** "Send a WhatsApp template" in the builder (only when the workspace has the module), through
the same runner, in its own commit: consent first on the WhatsApp channel and the template's own subject (a refusal
is a skip with the reason), then quiet hours and the weekly day off, the one-journey-message-a-day limit, the pause
while the company is in trouble (marketing templates), then the send function. The weekly cap defers the step to the
day it frees. The explain sentence, the reason table, the read-only "Try it on one person" line and the reference
check on save are all written for it.

**Surfaces done.** Migrations 0185 to 0188, flag in the platform-admin editor and new-tenant form, module
dependencies, nav item under Marketing behind the flag, workcenter `marketing_whatsapp`, `OBJECT_FEATURE`, `WAT`
references, change history on create, update (approval included), delete and the number, with the filter options,
capability file (experimental) and facts, the proxy allow-list entry (one anchored path), the demo seed
`scripts/seed-marketing-whatsapp-demo.sql`, and the ledger in PROJECT.md. **Guides**: no Drive guide was changed
(the feature is flagged off for every client); refresh the Marketing guide when the owner confirms.

**Skipped 3b surfaces, and why.** Field registry and custom fields, Data Workbench, v1 API and MCP: a message log is
personal data and a template is configuration, so none of these belongs in a shell (a test fails the build if a
WhatsApp read tool or v1 route appears, and the `custom_data` column is already there for later). Global search,
the Nova timeline, inbox and comment maps, the command-palette entry, the analytics tile, the reports metric, saved
queries: not records people look up by name yet.

## To enhance later (in the order I suggest)

1. **Pick the provider and write its adapter** (one file, steps in `provider.ts`). Meta Cloud API gives the
   cheapest messages and needs a Meta business account; a GCC business solution provider may be needed for
   Saudi and UAE number rules. Add the GET challenge handshake some providers need, and the provider's own
   template submission so the approval flag is set by the provider's answer, not a person.
2. **WhatsApp on the Forms consent block and the preference centre**, and a "WhatsApp" row on the contact's Consent
   card showing the START and STOP history; today an opt-in comes from the Consent card, an import or START.
3. **The conversation view on the contact and the lead**: replies on the timeline, the 24-hour window shown, a
   free-text reply by a person while the window is open (the rule exists; the screen does not), and a Nova inbox
   notice to the owner on a reply.
4. **Settings, Marketing, Channels**: the demo test number, the weekly limit and the provider choice as a settings
   page (today the number is on the WhatsApp setup page and the other two are read from `config.whatsapp`).
5. **Write `phone_hash` on contacts** from the contact create and edit routes, so number matching is automatic
   instead of on send and on demand.
6. **Cost estimate before Turn on** ("about SAR 0.25 x 120 people") and per-template delivery and reply rates.
7. **Languages**: the same template in several languages as one family, chosen by the contact's language the way
   the Newsletter Studio does; Arabic right-to-left preview.
8. **Media and buttons**: header image or document, quick-reply and link buttons, and button replies as events.
9. **Suppression for WhatsApp** (a number that is invalid or reported), checked by `canContact` beside the ledger.
10. **A campaign path**: send one template to a target group with the same audience check and dry run the
    newsletter send has; today WhatsApp goes to one person at a time or from a journey.
11. The skipped 3b surfaces above, once there is something to look up and report on.

## Decisions worth knowing

- **Why consent is asked before the template or the number.** A person who has not agreed must never be told
  "your template is not approved" instead of "no consent": the first is a setup problem somebody will fix, and
  fixing it would then send.
- **Why the identity table has no policy and the log is select-only.** The first holds credentials; the second
  decides the 24-hour window and the weekly limit, which a member must not be able to forge.
- **Why dry runs count toward the weekly limit.** A demo should behave like production.
- **Why `whatsapp.sent` is emitted for a dry run.** The event is flagged `dry_run: true`; attribution ignores those.
- **A number shared by two contacts** (a company line) is matched to the most recently indexed contact.
