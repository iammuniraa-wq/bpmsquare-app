# BPMSquare AI Vision — Why AI Is Core, Not a Feature

**Status:** Living doc — the standing answer to "why does BPMSquare say
AI-native," revisited every time a new AI surface ships.
**Date:** 2026-08-24
**Owner context:** written after a partner (a Microsoft Dynamics 365
implementation shop) agreed to resell BPMSquare alongside their own work,
with a demo scheduled that will lead with AI. The owner pushed back hard,
twice, on hearing that a chart-rendering layer or a paste-to-create UI had
to be built from scratch — "how could it possibly be [true that AI is core]
when we started the build with AI as core." This doc is the answer that
pushback deserves: written down once, so it doesn't have to be re-argued
every time a new AI surface needs new plumbing.

---

## 1. The distinction the pushback was really about

"AI-native from day one" and "every AI surface arrives pre-built" are not
the same claim, and conflating them is where the pushback came from.

What **was** true from day one, and is still true of every AI feature this
product ships:

- **The schema was never hidden from AI.** Every object BPMSquare has ever
  had — standard or custom — carries a machine-readable field catalog
  (`FIELD_REGISTRY`, `src/lib/fieldRegistry.ts`) as a *build requirement*
  (bpmsquarecore.md §3b), not an afterthought bolted on for one feature.
  That single catalog is what let the AI Report Builder cover every object
  in the system on day one of building it, instead of a hand-picked
  starter set — see `docs/ai-report-builder-architecture.md` §3.6. A
  competitor whose schema was never designed for a machine to read has to
  reverse-engineer or hand-document it before AI can touch it at all.
- **Every AI feature is built the same disciplined way**, not improvised
  per-feature: a forced tool call with a schema constrained to real,
  whitelisted fields, compiled into the *same* query path a human-written
  API call would use, checked by the *same* permission and tenant-isolation
  code every other route uses. There is no separate, weaker "AI path"
  anywhere in this codebase. See §2.
- **Multi-tenancy and AI were designed together, not layered.** Every AI
  capability inherits `resolveTenantFromBearer`/`requireTenantUser` and
  `canViewWorkcenter` exactly like a human-facing route. An AI feature that
  could see across tenants, or past a caller's own Business Role grants,
  would be a defect by the same standard as any other route — not a
  special case to reason about separately.

What was **never** promised, and isn't what "AI-native" actually means:
that every conceivable AI *surface* — a chart renderer, a paste-to-create
modal, a natural-language report builder — would exist pre-built before
anyone asked for it. A foundation designed for AI from day one is what
makes each new surface fast and safe to add later; it is not the same
thing as having already added all of them. **The moat was never "we
already built every AI feature." It's "our data model, our permission
model, and our API surface were shaped so AI features are cheap, safe, and
fast to add — while a system that bolted AI on afterward has to retrofit
all three first."** That gap is real and it compounds: every AI feature
BPMSquare ships gets cheaper to build than the previous one, because it
reuses the same three pieces of infrastructure. See §2.

---

## 2. The reusable substrate — three pieces, one discipline

Every AI feature in this product is an application of the same three
building blocks, not a bespoke integration:

1. **The safe NL→query pattern.** A forced tool call
   (`tool_choice: {type:"tool", name:"..."}`) whose JSON schema constrains
   field names to an explicit `enum` drawn from a real, permission-filtered
   whitelist. The model's output is compiled into the *same* wire-format
   query string (`filter=...&group_by=...`) a human-written REST call would
   send, then validated by the same `parseListQuery()`/`applyListQuery()`
   every list endpoint already runs through. First proven in
   `POST /api/v1/ask`; reused unchanged in structure for the in-app Report
   Builder (`POST /api/reports/ask`) and for the two-stage object-routing
   step that made "every object, not a curated few" tractable. The model
   **never** writes SQL, **never** sees a raw data row during compilation,
   and **never** produces a displayed number directly — see §3 for why
   this is the actual anti-hallucination mechanism, not a prompt
   instruction.
2. **`FIELD_REGISTRY`, one catalog per object.** Because bpmsquarecore.md
   §3b makes this catalog mandatory for every object the product has —
   long before Report Builder existed — any future AI feature that needs
   to know "what fields does this object have, in this tenant, right now"
   reads the same source of truth a human-facing form already reads. This
   is the concrete reason a 12-object (and growing) report builder was
   buildable in one pass instead of a hand-written field list per object.
3. **The permission-gated capability pattern.** Each AI capability declares
   the `WorkcenterKey`(s) it touches and is filtered through
   `canViewWorkcenter(perms, ...)` *before* the model ever sees the
   catalog entry for it — so "the AI only knows about data this caller can
   see" is true by construction (an object the caller can't view is never
   in the prompt), not by the model choosing to behave. First built for
   the read-only assistant (`src/lib/ai/assistant.ts`), reused unchanged
   for Report Builder's routing stage and for Nova's `next_experience`
   gate on record drafting.

A genuinely bolted-on AI layer looks different from this: a chatbot that
gets schema explained to it in a system prompt (drifts the moment the
schema changes), a "just ask the model to write SQL" shortcut (a standing
injection and cross-tenant-leak risk), or a single "does this user have
any admin role" check standing in for real per-object permission
filtering. None of that exists in this codebase, on any AI surface,
anywhere — checked and kept true on every AI feature added.

---

## 3. How hallucination and fabricated numbers are actually prevented

This is a mechanical answer, not a policy one — the same one given directly
when the owner asked "how is hallucination prevented, how is a hardcoded
answer prevented":

- **The model never touches data, only the recipe for fetching it.** Every
  NL→query surface forces the model to emit a *query* (filters, group_by,
  aggregate) against a whitelisted field enum. That query is compiled to
  the exact wire format the real API already validates and executes. A
  hallucinated field name is rejected by that validation before it ever
  becomes a request — the failure mode is a 422, not a wrong number shown
  confidently.
- **The engine, not the model, has the last word on what's shown.** In
  Report Builder, the compiled query's *actual shape* (count-only vs. an
  aggregate, a date-typed group-by vs. a categorical one) decides the
  chart type server-side (`decideChartType()`), overriding whatever the
  model suggested. The pricing engine follows the identical philosophy for
  its own AI-assisted flows: the model proposes, code that can be read and
  tested decides. "Engine is truth, model is advisory" is a rule applied
  consistently across every AI surface in this product, not invented once
  for one feature.
- **Every answer that involved an assumption says so, visibly, in the
  same response — never hidden in a log.** When a question is resolvable
  but required picking an interpretation (which date field, which status
  set), the response carries a mandatory `interpretation` line naming
  exactly what was measured, shown right next to the number. Genuinely
  ambiguous questions get one specific clarifying question instead of a
  guessed answer; unanswerable ones get an explicit decline with a reason.
  There is no fourth path where the system silently picks an assumption
  and shows a number with no way to tell it did.
- **PII never reaches the model's context for aggregation-that-becomes-
  display.** Fields marked `sensitive` (email, phone, ...) can be
  aggregated *over* but are stripped from `select` before compilation,
  regardless of what the model asked for or what the caller's own
  workcenter access would otherwise permit — a report-specific policy
  layer on top of, not instead of, ordinary access control.
- **A saved report is a saved *recipe*, never a saved answer.** Re-opening
  a saved report re-runs the compiled query against live data and never
  re-calls the model — a report can't go stale into a hallucination, and a
  viewer whose own permissions later narrow loses access to a report the
  moment that happens (permissions are re-checked on every open, not
  cached from creation time).

None of this is a per-feature decision the team makes freshly each time —
it's the one discipline described in §2, applied again.

---

## 4. Record creation: paste something, review it, then it's real

Nova's second pillar (bpmsquarecore.md §10) is AI-assisted record creation:
paste an email, a WhatsApp message, a signature block, and get a **drafted**
record — Account, Contact, Quote (header), or Product — for a human to
review before anything is saved.

The same document-extraction engine Data Workbench uses for bulk
import (`buildObjectSpec()` / `extractRowsFromDocument()`) is reused
unchanged, pointed at one pasted string instead of an uploaded file. Two
guarantees hold on every object this covers, not just the first one built:

- **Nothing is created by the extraction call itself.** The endpoint
  (`POST /api/nova/draft`) only ever returns a draft — the same field
  catalog and validation a human-typed form would use, pre-filled. The
  actual `POST /api/accounts` / `/api/contacts` / `/api/quotes` /
  `/api/products` call only fires after a human reviews the form and
  presses Create, so every ordinary guardrail (required fields, tenant
  checks, duplicate warnings) applies exactly as if the record had been
  typed by hand.
- **A relationship a drafted record needs (an account for a contact or a
  quote) is drafted and resolved the same way, never assumed.** The
  extraction engine drafts the account from the same pasted text,
  searches for a real existing match by name, and lets the human pick
  "use this existing one" or "create a new one" — never silently
  fabricates or silently guesses an `account_id`.

This is also gated the way every experimental Nova surface is gated
(bpmsquarecore.md §10, rule 1): server-side on the platform-admin-only
`next_experience` flag, in addition to the object's own module flag, so it
can never reach a tenant the owner hasn't personally turned it on for.

---

## 5. The aspiration, stated plainly

The claim worth defending is not "every AI feature already exists." It's
this:

> **In BPMSquare, asking a question in plain English or pasting a message
> to create a record is not a bolt-on chatbot wrapped around the product —
> it is the product's own data model, permission model, and API surface,
> reused through one disciplined pattern, surfaced conversationally.**

Every AI feature shipped so far — the read-only assistant, the AI Report
Builder, Nova's paste-to-create — is a proof of that claim, not an
exception to it. The measure of whether that's still true, on every future
AI feature: does it reuse `FIELD_REGISTRY`, the forced-tool-call→
validated-query pattern, and the same permission/tenant checks every other
route uses — or does it introduce a second, weaker way for AI to touch
this product's data? The day the answer to the second question is "yes"
is the day the moat this doc describes stops being true. It hasn't
happened yet, and keeping this doc honest on every future AI feature is
how it stays that way.
