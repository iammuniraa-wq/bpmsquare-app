# inbox
status: experimental
plain: One shared place for the mail customers send you: it arrives on a forwarding address or from your own mailbox, a team reads and answers it, and one tap turns it into a Quote, Project, Case, Lead or Estimate with the customer's drawings copied across.
rules:
- Each address is a channel with its own team, its own default for what Create offers first, and the address replies go out from; only people on a channel's team (and admins) can see its mail, and a mail of a channel you are not on does not exist for you.
- Mail reaches a channel two ways: sent or forwarded to its own address, or read from the company's connected Gmail or mail server, which is only ever read and never has anything marked read, moved or deleted on it; the first read goes back three days.
- Mail is untrusted: it is stored as text, shown as plain text and never as a page, no link or file in it is opened by BPMSquare, and nothing in it is followed as an instruction.
- Auto-replies, bounces, out-of-office messages and BPMSquare's own mail are ignored, so a reply can never start a loop, and the same message arriving twice, or by both routes, is kept once.
- Files are kept privately and only as PDF, DXF, DWG, Word, Excel, CSV, PNG, JPG or text, checked by what the file really is and not by its name or what the sender called it; each file is labelled Good, Needs review or Poor, and a photo, a scan or a DWG is never treated as a clean drawing.
- A reply goes only to the person who wrote, from the channel's own mailbox when it has one, threaded in their mail program, and is kept in the conversation; a demo workspace sends nothing to a customer.
- Create from this email makes the record through its normal create screen's rules, copies the files onto it, stores the sender and a short summary on it, links the email to it and marks it handled; an email becomes one record, and an estimate is linked when it is saved.
- An email that became a record keeps its body for 30 days and one that never did for 90 days, then the body and files are cleared and only the sender, subject and the record it became remain; the copies on the record are kept.
- Switched on per workspace by a platform admin; until then there is no menu item, no route, no forwarding address and no mailbox reading, and a pending database update shows as "database update needed" instead of an error.
