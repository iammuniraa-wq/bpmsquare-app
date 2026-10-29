# KAMCO handover test log (2026-10-29)

Test records are prefixed TEST. Created in this pass: deal OPP-0025 "TEST Deal - Pump station package (batch 1)"; tender OPP-0026 "TEST-HANDOVER-001 · TEST Coastal Developments LLC" (bid decision proposed, waiting approval). Delete both after the call.

## Batch 1: enquiry to deal or tender
| Step | Result |
|---|---|
| Email into Inbox | NOT READY: Inbox has no channel/address (Settings > Inbox channels). Customers cannot email in yet. |
| New deal (Pipeline > New Deal) | Pass. OPP-0025 created. |
| New tender (Pipeline > Tenders > New tender) | Pass. OPP-0026 created, stage Received. |

## Batch 2: bid decision
| Step | Result |
|---|---|
| Propose Go with reason | Pass. Status "Awaiting approval". |
| Approve | Not tested. Proposer cannot approve own proposal (self-approval off, correct). Needs a second approver or self-approval switched on temporarily. |

## Batch 3: BOQ, costing, bid (read on seeded tender 2026/021)
| Step | Result |
|---|---|
| BOQ tab | Pass. 12 lines, 42% priced, stale price flagged, unpriced listed. |
| Costing tab | Pass. Rows priced / need cost / RFQs out / replies in. |
| Bid tab | Pass. Pre-submit checks listed. |
| Check | Header says "Bid decision: Go recorded" but Bid tab says "No approved go decision" on 2026/021. Likely seed data; confirm. |

## Clean-up before handover
- Approvers include sap.rashid@gmail.com, sap.rashid+kamco@gmail.com, sna2care@gmail.com. Keep Anas and Abdulkhader.
- Display names: "Anas abc", "Ab Na" (not an admin). Fix in People.
- TEST accounts, tenders, deals remain.


## Dry run 2 (full flow from an email, 2026-10-29 evening)
Email in Inbox (filtered) > Create Deal (OPP-0027) > bid decision proposed and approved > BOQ uploaded (12 lines) > RFQ-0005 sent via own mailbox > two replies entered > compare and award (Precast Arabia, 712,920) > BOQ priced 100% (819,858 with 15%) > bid version 1 submitted > Awarded > contract project CPR-0002 (budget 712,920, margin 13%). All passed.

Fixed during the run: Gmail connector credentials (address kept in config), stale test message, mailbox reader skips unreadable messages and falls back to a date search, Read mail now button, sender/subject channel filter (migration 0236, bundle 44).

Open gaps: Edit button for connector setup; draft RFQ with hand-keyed replies cannot be awarded; tender BOQ does not offer the email's own attachment; bid end date not read from the email; Team picker lists roles of modules not in the workspace; channel Create-offers suggests Quote first; approvers list includes owner test accounts; names "Anas abc", "Ab Na"; inbound address needs a platform domain; Gmail App Password may be unavailable on some accounts.

Clean-up before handover: Email output back to business partners; self-approval off; delete TestKamco channel and the copied mail (cleanup SQL + Storage folder); delete the Google App Password; supplier test addresses (.example) removed; TEST deals/tenders/RFQs/accounts; fix variable name RESEND_SENDING_DOMAI in Vercel.
