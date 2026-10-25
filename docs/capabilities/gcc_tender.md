# gcc_tender
status: experimental
plain: GCC tender deals. The Pipeline gets a Tenders tab for bids the issuer invites: each tender is a deal with its own stages, a closing-date countdown, a recorded go or no-go decision, a bid-bond block and reminders to the owner and team before it closes. A customer email can become a tender in one tap.
rules:
- A tender is an ordinary deal plus a tender block; the Deals tab and board never show it, and the Tenders tab never shows a standard deal.
- Tender stages are Received, Bid/No-bid, Estimating, Submitted, Clarifications, then Awarded, Lost or No-bid, which close the deal as won, lost or dropped.
- A team member proposes go or no-go with a reason and a manager approves or rejects it with a comment; the tender cannot leave Bid/No-bid for Estimating without an approved go, nor go to No-bid without an approved no-go, and the system records who and when.
- Approvers are chosen in Settings, Tenders (workspace admins by default); the proposer cannot approve their own proposal unless the workspace allows it.
- A bid bond is held until someone releases it; a released bond stops the expiry warning and the bond line in reminders.
- On a tender deal's Lines tab, Request supplier prices raises an RFQ from the saved lines, carrying the client's item numbers, to any number of suppliers (vendors or subcontractors can be filtered); the replies are compared and awarded on the RFQ.
- The owner and team are emailed 7, 3 and 1 days before the closing date and on the day, once each, until the bid is submitted.
- The flag is set by a platform admin; a workspace without it sees no new tab, menu entry or screen, and standard deals behave exactly as before.
