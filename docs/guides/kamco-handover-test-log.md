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
