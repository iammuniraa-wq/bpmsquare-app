# webhooks_library
status: experimental
plain: One list where every webhook is created and kept: change-feed events pushed to a system, and calls fired by a quote award, a record button or a Coverage route, each with its own address, headers, payload and test.
rules:
- A webhook is an Event (the signed change feed, sent in batches) or a Call (one record sent when something fires it); the kind and, for a Call, the object (Accounts or Standard Quotes) are fixed after it is created.
- The address must use https and a public host; a private or internal address, a redirect to one, and personal data or a list inside the address are refused, and an older http address kept from the ERP push does not fire until it is edited to https.
- The signing secret and every header value are sealed and write-only: after saving they read back only as "set", and the secret can be regenerated but never shown again.
- A Call sends the standard signed record or the admin's own JSON template with a closed list of tokens; personal data is left out unless allowed, cost and margin fields are never available, and a template that does not parse or uses an unknown token is refused with the token named.
- Every call is a row in the message monitor with its request and response; a failed one is retried once after 2 seconds on a network error, 429 or 5xx, can be restarted, carries the same idempotency key on every attempt, and the webhook pauses itself after 15 failures in a row.
- An awarded Standard Quote reaches a webhook only through the Links target, once: sending twice or restarting never fires it twice, and a rejected quote never leaves; a demo workspace records the call and sends nothing.
- Deleting a webhook that a Link, a Coverage route or the Accounts button uses is refused and names where.
- Switched on per workspace by a platform admin; until then there is no menu item and no route, and a pending database update shows as "database update needed" instead of an error.
