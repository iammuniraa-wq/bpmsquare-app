# marketing_forms
status: experimental
plain: Put a contact form on the company website that records what the visitor agreed to, adds them as a contact and files a lead, and let every person change what they hear about from one page.
rules:
- The consent box is never ticked for the visitor; the exact words shown, the time and the form are kept with each answer.
- A person who ticks the box is recorded as agreeing to the topics the form names; a person who does not tick it is not recorded as agreeing to anything.
- An existing contact is found by email and is never changed by a form; a new visitor becomes a prospect account, a contact and a lead.
- Spam is stopped by a hidden trap field, a minimum time to fill in, a limit per visitor and a size cap; no CAPTCHA is shown.
- The raw answers are kept for 180 days and stored encrypted; only the contact, lead and consent records remain after that.
- The preference page opens from a signed link in each email and every change is added to the consent history.
- Switched on per workspace by a platform admin and needs Marketing campaigns; until then the public pages answer not found and there is no menu item.
