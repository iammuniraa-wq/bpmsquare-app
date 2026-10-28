# Assistant actions: from read-only to create, change and delete (roadmap)

> Owner 2026-10-28, after the KAMCO assistant answered "I cannot edit, create or delete records": "add more AI capabilities, not that we need
> today for KAMCO, but to have it in the pipeline." This is the design and the build order. Nothing here is built yet; KAMCO stays
> read-only until the people setup is done and the owner says go. Builds on `assistant-smarter.md` (section 3 "Create from chat" and
> WP6 as built) and `src/lib/actions/registry.ts`.

## What is already there (rule 6c)

- The dock assistant (`src/lib/ai/assistant.ts`): read-only query and chart tools, `navigate`, `open_record`, `propose_web_search`,
  page guidance, daily briefing. Rule 7 of its prompt tells it, when no actions are offered, that it cannot create, change or delete.
- `create_record` (`src/lib/assistant/createTool.ts`): a confirm card; nothing exists until the person presses it. Registry `ACTIONS` holds
  **account** and **contact** only; `DEFERRED` names every other collection route with the reason; `DEFERRED_VERBS` names the two ERP
  verbs on sales orders. `registry.test.ts` fails when a route is in neither list (a new object is a decision, not an oversight).
- The gate `actionsEnabled()`: `ai_assistant` + `ai_assistant_actions` + `next_experience` (Nova), all platform-admin flags; then the
  object's module flag and the Business Role's create grant on its workcenter (`availableActions`).
- Change log marks "via assistant" (audit 2026-10-22, `src/lib/changeLog.ts`); every write goes through the same API routes as the screens.

## Principles (unchanged from assistant-smarter.md section 6)

1. The assistant never writes by itself: every create, change or delete is a card the person reads and presses. The press calls the
   object's own API route, so validation, tenant isolation, permissions and change log are the screen's, not a second copy.
2. A card shows exactly what will happen: the object, the fields, the linked records resolved by name (and the id it resolved to), and for
   a change the before and after of each field. A delete card names the record, what hangs off it (cascade), and needs a typed word only
   where the screen also asks for one.
3. Permission = what the person could do on the screen: create grant for creates, edit grant for changes, admin or the screen's own rule for
   deletes. Business Roles stay menu visibility (owner decision 2026-10-23); the server rule is the route's.
4. No new flag per object: the existing `ai_assistant_actions` flag covers all three verbs; the registry is the allow-list.

## Steps, in order (each its own design check-in, Sonnet build, validated on demo first, then widened by the owner)

0. **Wording when actions are off** (small, any time): rule 7 says "creating and changing records is not enabled in this workspace" and
   offers the New screen, instead of "I cannot". One prompt line and its test.
1. **Decouple actions from Nova.** `actionsEnabled` = `ai_assistant` + `ai_assistant_actions`; Nova no longer required (owner decision needed:
   today the gate is what keeps a client workspace read-only; after this the flag alone does). The confirm card already renders in the
   classic dock. Test: a classic workspace with the two flags gets the create tool.
2. **More create cards**, registry entries with their required links resolved by business key: supplier, product, lead (consent fields
   required), case (account + asset), asset (account), opportunity, tender deal (tender number, issuer account or name, portal, bid end
   date: the fields `New tender` asks for), RFQ (deal or package + supplier names, lines from the deal's unpriced lines), estimate from a
   named template. Each entry says `featureKey` and `workcenter`; `DEFERRED` shrinks as entries move. Order: supplier and product (same shape
   as accounts), then tender deal and RFQ (the tender edition), then lead, case, asset, opportunity, estimate.
3. **Change cards (verb "update")**: a `change_record` tool taking object + record (resolved by ref or name, ambiguous = ask) + the fields to
   set; the card shows before and after; the press calls the object's PATCH with its allow-list. Scope: the plain fields the PATCH already
   accepts; never money totals that the engine computes, never status transitions (those are step 4). Audit: `diffForLog` via the route.
4. **Transition cards (verbs)**: `DEFERRED_VERBS` becomes the verb registry: propose or decide bid / no-bid, submit a bid version, award an
   RFQ, award a buy-out package, mark handover sent, convert quote to order, send to ERP, check with ERP, remind suppliers, mark a lead
   converted. Each verb = its existing POST route + a card listing the checks that are not a pass (the way the screen's button does).
5. **Delete cards**: `delete_record` for the objects whose screens allow delete, admin or the screen's rule, with the cascade named; soft
   delete where the object has one. Never for employees, business users, roles, settings.
6. **Bulk by chat**: "create these five suppliers" = five cards or one table card with one press; capped (10), same routes, same audit.
7. **Voice and proactive** stay in `assistant-smarter.md` section 10.

## Safety and tenancy (each step repeats these in its tests)

- The tool never receives or passes a tenant id; the route resolves it from the session (`requireTenantUser`).
- Record resolution by name is tenant-scoped and refuses ambiguity (asks) instead of guessing; the id shown on the card is the proof.
- Text inside records is data (prompt rule 10); a record whose notes say "delete me" is not an instruction.
- Every press is logged "via assistant" with the actor; the assistant's own transcript never holds secrets or PII beyond the fields shown.
- Rate: one card per message; no auto-press, no chaining of writes without a press between them.

## Definition of done per step

Registry entry or tool + its test; the route unchanged or extended with an allow-list; render test of the card; prompt test; demo
validation by the owner; the Nova/AI guide note after validation. Each step is a commit that says what moved out of `DEFERRED`.
