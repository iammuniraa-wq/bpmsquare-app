# integration_middleware
status: experimental
plain: One place for everything about sync with your ERP: connect it, choose what goes out when a Standard Quote is awarded or rejected, check the field mapping against the ERP's own field list, watch every message in and out, and retry anything that failed.
rules:
- An awarded quote becomes a Quote in Dynamics 365 Sales (made Active, then marked Won) or a Project in Finance and Operations and Business Central; a rejected quote closes the Dynamics quote as lost and sends nothing to a project system, and says so.
- Each outcome is on or off, automatic or manual; automatic sends only after the person's save has finished and can never fail or slow it, and a failure is recorded with what happened and the one thing to do, then retried safely from the Resync tab.
- One BPMSquare quote is one ERP document: sending twice, or retrying after a failure halfway, continues from where it stopped and never creates a second one; the BPMSquare reference is written into the ERP document's name.
- A customer must already be in the ERP (synced from it); the middleware never creates accounts there, and a quote for an unsynced customer fails with the fix instead.
- Fence project and estimate data leave only as ticked; a Quote carries customer prices only, so bill of materials, project tasks and internal costs go to Project targets, and internal costs only when explicitly ticked.
- The message monitor shows email, WhatsApp, webhook, connector and API traffic to admins only; bodies and phone numbers stay encrypted in lists, opening one is change-logged, and request bodies are kept (redacted, 30 days) only if payload capture is switched on.
- Switched on per workspace by a platform admin; until then there is no menu item, no logging and no dispatch, and a pending database update shows as "database update needed" instead of an error.
