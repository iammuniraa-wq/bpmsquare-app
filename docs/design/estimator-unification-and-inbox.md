# One estimator (fence, precast, tiles, porta cabin) and the shared inbox: decisions so far

> Brainstorm with the owner, 2026-10-23/24. Not built. Complements `docs/design/gcc-sales-estimating-plan.md` sections 4 and 5.

## One Estimate object, many templates

- A **template** = inputs + BOM rules (formulas) + optional **layout module** (preview and geometry). Fence, precast villa, floor tiles and
  porta cabins are templates, not features. The existing Estimator is the base; Fence becomes a locked starter template.
- A layout module takes the inputs and returns pieces and counts (posts, tiles, cuts, units). Counts feed the BOM formulas, so the BOM
  stays data and only geometry is code. Modules: none (BOM table only), 3D pieces (precast, cabins), 2D floor tiling (tiles).
- **Copy to customise** (owner): starter templates are locked; a client copies one to change it. Starter packs per workspace come from
  scoping (country and product line).
- Same ending for every template: estimate with margin, then a Standard Quote, later a Sales Order. Migration of Big Blue's fence
  projects keeps their numbers and FNC refs as aliases.

## Template choice and AI drafting

- Each template carries a plain name, description, picture and keywords. Staff pick from cards; an optional customer self-serve
  "Request an estimate" page (later; staff-only first) shows only customer-visible templates.
- Email to draft: the AI gets the email plus the template list and returns a template with a confidence (or "not sure"), then reads the
  email against that template's own input list. Each input is Found, Likely or Missing, with the source words shown. Staff can switch the
  template; nothing is saved until Create; Missing is never guessed; units converted.

## Shared inbox

- Mail enters through (1) a per-workspace forwarding address (first), (2) polling the client's mailbox, (3) the client's own domain (later).
  Stored in our database (encrypted body, attachments in a private folder per workspace); untrusted content, shown escaped.
- **Channels:** each address is a channel: who sees and replies (team), what "Create" offers first (Quote, Project, Case, Estimate with a
  template), and the address replies go out from. One table in Settings > Inbox channels.
- **Retention (owner):** once an email becomes a record, its body is kept 30 days then discarded; converting copies attachments to the
  record's Files and stores a summary and sender. Mail never converted is purged after 90 days.

## Drawings (owner decision 2026-10-24: DXF)

- Customers are asked to send **DXF or PDF** (Word and Excel also read). DWG is not accepted directly; a customer saves as DXF
  (Save As). Photos and plain scans are a last resort: read as far as possible, the rest Missing, always reviewed.
- Build order: (1) read PDF and Word, schedules and labelled dimensions into the template inputs with a highlight-on-drawing review;
  (2) DXF reader (open-source parser, measures lengths, areas and counts by layer and block; the template maps layers to inputs) plus an
  in-browser DXF viewer so a click on a value highlights its lines; (3) scale-and-trace tool for plans without dimensions.
- Each attachment gets a quality label (Good, Needs review, Poor); a one-tap reply asks for PDF or DXF; each client gets a one-page
  "how to send us drawings" guide per template.
- A person confirms everything before it is saved; sanity checks flag totals that do not add up.
