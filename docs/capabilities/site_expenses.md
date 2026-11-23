# site_expenses
status: experimental
plain: A person on site photographs a receipt on a phone, picks a category and submits; the project manager approves it and it counts as recorded cost on its budget line at once, then goes to the ERP as a proposal finance posts.
rules:
- The photo is the form: the phone opens the camera first, the person picks a category and the project and presses Submit; the amount, date and vendor may be read from the photo and are only a proposal the person checks.
- An expense can be saved with no signal and uploads when the phone is back online; sending it twice never makes two expenses, and a rejected one stays visible on the phone with the reason.
- A waiting expense is exposure, not cost; an approved one counts as recorded on its budget line at once, and a posted one replaces the recorded amount with the posted one, never both. The budget line's own Actual column stays the ERP's figure.
- The project manager approves within a limit set in Settings, a cost approver (the same people as a bid decision) approves anything, and nobody approves their own expense unless the workspace allows self-approval; returning an expense needs a reason.
- A possible duplicate (same amount, vendor and project within 60 days, or the same photo), an amount over a limit or a monthly cap, and a missing cost line are shown as warnings and never block.
- A site person never sees budget figures; a manager sees the expense against its budget line.
- A foreign-currency expense is entered in the project currency by the approver; the VAT amount is captured and the cost counts as typed.
- Nothing is posted to a ledger and no vendor or category is created in the ERP: approved expenses leave as a daily Excel register that the person who uploads it marks as sent.
- Switched on per workspace by a platform admin and needs Contract projects; until then there is no menu item, route, tab or button.
