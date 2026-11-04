# crew_tender_watch
status: experimental
plain: Tender Watch. Each morning it looks at the live tenders, says which are at risk of missing the bid end date or going in incomplete, and who is holding each one up. It can draft a short note to that person for the deal team to edit and send.
rules:
- It needs AI automation and GCC tender deals; the Deal Room and RFQ make its findings richer but are not required.
- A day with no tender in the watch window costs nothing: the plain rules pick the candidates first and the model only judges those.
- It never predicts a win, never suggests a price or margin, never advises bid or no-bid, and never states a number a tool did not give it; every figure and date is filled in by the server from the records it read.
- The countdown e-mails and the Tender desk attention list stay plain rules and keep working as they are; Tender Watch reads them as inputs.
- A finding goes to the deal owner, the team and workspace admins; a person can dismiss it or mark it Not an issue, which silences it for 30 days unless the situation gets worse.
- A drafted note goes to the named person only after the deal owner, a team member or an admin edits and sends it, as a Deal Room mention and an e-mail; at most 3 per person per day and none about the same deal within 48 hours.
- A person can opt in to a daily digest e-mail for themselves; it goes to internal members only and is redirected on a demo workspace.
