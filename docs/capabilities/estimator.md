# estimator
status: live
plain: Turn a few answers or an element schedule into a bill of materials, a cost build-up and a standard quote, using templates your admin sets up once.
rules:
- An estimate belongs to a template made of inputs, rates and rule lines.
- Once an estimate has a quote, its numbers can no longer change.
- Starter templates for pipes and fittings, precast elements and civil basics price their materials from catalogue items marked illustrative until a rate sheet is imported.
- An administrator imports a supplier rate sheet (Excel or CSV) in Settings, Estimate templates: matched items get the new cost and date, the old cost is kept, and a price older than the RFQ validity days is imported but shown as stale.
