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
- The BOQ tab reads the client's Excel (.xlsx) into deal lines, keeping their item numbers and cost codes; a revised file updates lines by item number and never silently removes a priced line.
- Each BOQ line is priced from the client's own rate, a product BOM or estimate, a past awarded tender, a supplier quote or a manual rate, and shows which source set it and how old it is.
- A supplier or past-project price older than the workspace's price validity (180 days by default, set in Settings, Tenders) is marked stale and is never applied automatically; a person may still choose it knowingly.
- Download priced BOQ writes the unit rate and amount into the client's own file and keeps its layout; Export answer sheet gives a plain Excel list for a portal form such as Ariba. Cost and margin never appear in either file.
- The Bids tab saves each bid that goes in as a numbered version (no limit) with the deal's lines and total as they were, never a cost or markup; from the second version a reason is required, and any two versions can be compared line by line and by total.
- Submit bid moves the tender to Submitted and Revise bid returns it to Estimating; a saved version is never edited or deleted.
- Log a call records a call, meeting or site visit with a next step and date on the deal's Activity tab (and from the Deal Room); an overdue next step shows as a chip on the Tender tab until it is ticked done.
- Once a tender is Awarded, Lost or No-bid, the Tender tab records the outcome: awarded value, who won and the winning price, and why it was lost (the reason and the winner are required for Lost), with our last submitted total beside the price.
- The flag is set by a platform admin; a workspace without it sees no new tab, menu entry or screen, and standard deals behave exactly as before.
