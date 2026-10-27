# rfq
status: live
plain: Ask several suppliers for prices by email, receive their replies back inside BPMSquare, compare and award.
rules:
- Supplier replies are read from the email and filled into the request for a person to confirm.
- The comparison shows one row per line and one column per supplier with price, lead time, minimum order, validity and the age of the answer, marks the lowest valid price, and shows an expired or stale answer in amber and never as the lowest.
- A supplier who has not answered shows as waiting with the next reminder date; an answering supplier shows how many of the lines they quoted and the total of those lines.
- Awarding records who chose the supplier and when, and requires a reason whenever the chosen price is not the lowest valid one; changing an award keeps the earlier decision in the history.
- An award saves the supplier's price on the product, and for an RFQ raised from a deal it can write the awarded prices onto the deal lines as their rate.
- An RFQ may go to any number of suppliers, including one.
