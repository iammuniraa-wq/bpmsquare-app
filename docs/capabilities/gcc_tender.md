# gcc_tender
status: experimental
plain: GCC tender deals. The Pipeline gets a Tenders tab for bids the issuer invites: each tender is a deal with its own stages, a closing-date countdown, a recorded go or no-go decision, a bid-bond block and reminders to the owner and team before it closes. A customer email can become a tender in one tap.
rules:
- A tender is an ordinary deal plus a tender block; the Deals tab and board never show it, and the Tenders tab never shows a standard deal.
- Tender stages are Received, Bid/No-bid, Estimating, Submitted, Clarifications, then Awarded, Lost or No-bid, which close the deal as won, lost or dropped.
- A no-go decision needs a reason; the person and the time are recorded by the system, not typed.
- The owner and team are emailed 7, 3 and 1 days before the closing date and on the day, once each, until the bid is submitted.
- The flag is set by a platform admin; a workspace without it sees no new tab, menu entry or screen, and standard deals behave exactly as before.
