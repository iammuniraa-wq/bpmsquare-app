# Marketing platform: what is built, what comes next (2026-10-21)

One page to choose the next step from. Everything below is on `develop` and
`main` (commit 0303fe47), **off for every client** behind a platform-admin
flag, and degrades quietly until its SQL has been run. Each shell has its own
detail page in `docs/shells/`.

## Built

| Piece | Flag | Built in the shell | Detail |
|---|---|---|---|
| Foundations (M0) | `marketing_scoring` | One activity stream, contact matching by email, the consent gate (strict by default), scoring engine, 8 lead stages, Settings → Marketing | `marketing-platform-architecture.md` |
| Newsletter Studio | `newsletter_studio` | Newsletters in English with Arabic added on top, AI draft/rewrite/translate with review, templates, signed click links, send through the consent gate, audience panel before sending, "see it as this person", language compare, content health | `newsletter-studio-architecture.md` §13-14 |
| Email health + staff consent | `newsletter_studio`, `marketing_scoring` | Resend delivered/bounced/complained on the contact, check/fix the address, "Needs attention" list, consent card on the contact, consent import | commit notes |
| Self-scoring leads | `marketing_scoring` | Score with reasons, stages, round-robin owner, response time, Ready-for-sales notice, scored list, Account 360 card | `shells/leads-shell.md` |
| Journeys | `journeys` | Builder, runner, safety rules, "why it fires / is held", live counts, preview and guardrails, one template (Quote follow-up) | `shells/journeys-shell.md` |
| Forms + preference centre | `marketing_forms` | Form builder, hosted page and embed, consent recorded on submit, lead created, preference centre | `shells/forms-shell.md` |
| Buying signals | `buying_signals` | "Who is in market", first-party score, stage, reason, movement, sparkline, timeline, audience fields, alerts | `shells/signals-shell.md` |
| ABM | `abm` | Programs, target accounts, buying groups, rule-based progress with override, results funnel, Account 360 card, full object surfaces | `shells/abm-shell.md` |
| Process Design Studio | `process_studio` | Six-step intake to fit report to plan to "Talk to us", admin review | `process-design-studio-architecture.md` |

| WhatsApp | `whatsapp_marketing` | Provider-agnostic adapter (log-only sandbox), templates with approval, one consent-gated send, signed inbound webhook, journey step | `shells/whatsapp-shell.md` |
| Attribution | `marketing_attribution` | Touches ledger, first / last / shared models, three-hourly recompute, Revenue by source page | `shells/attribution-shell.md` |
| Events | `marketing_events` | Events with registration through forms, check-in, no-shows, follow-up journey, results | `shells/events-shell.md` |

Also on develop (2026-10-21): screen simplification batches 1 and 2 with the
label fixes L1-L8 (`docs/design/ux-simplification.md`), the three side
branches (segment Coverage fields now match; Business Role grants enforced on
every marketing page and route; WFM supervisor scope on first paint), forms
thank-you email + double opt-in, and the lead hand-over settings with
auto-created leads and overdue notices (see the shell docs for what each
left for later).

## Next enhancements, suggested order

1. **Thank-you email and double opt-in for forms** (forms list item 1), so a
   submission is confirmed by the person.
2. **Auto-create a lead when a contact becomes Engaged** (leads item 1; needs
   your decision) and the Settings screen for response time and weekends.
3. **Journeys: health and step performance, then the flow heatmap**
   (journeys a-b), then ABM plays on the same engine.
4. **ABM: "My ABM day", quick actions on rows, richer results**
   (abm items 1-3).
5. **Signals: program heatmap and suggested plays** (needs ABM + journeys),
   then outside data sources (news, tenders, jobs).
6. **Newsletter: reusable components, comments and approvals, suggested
   subject lines and send times.**
7. **Surfaces skipped on purpose** (Data Workbench, API, MCP, search,
   analytics tiles) per object, in the "every surface" pass (M9).
8. **Drive guides** once you have validated each piece.

## Open decisions (defaults used meanwhile)

Lead response time and weekend days; whether any member can take a Ready
lead; the "Talk to us" address; WhatsApp provider; Etimad portal approach;
reverse-IP provider; open-tracking default (off); Saudi consent default
(strict, relax only after counsel review).
