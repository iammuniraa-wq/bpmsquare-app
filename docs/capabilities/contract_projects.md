# contract_projects
status: experimental
plain: Contract projects. The project a won tender becomes, with a cost budget by resource type and cost code, numbered revisions with a reason, a baseline a manager approves, and an Excel file for handing it over. Not the Workforce projects.
rules:
- A contract project is made from an awarded tender in one step (one project per tender) or started by hand; the tender's lines become the baseline budget.
- A line whose cost is recorded keeps it; any other line starts at the selling rate less the workspace's default margin (Settings, Contract projects) and is marked estimated until someone types the real cost.
- Each budget line has a resource type and a cost code from lists held in Settings, Contract projects; the lists start as defaults and a CSV or Excel import replaces or extends them.
- A manager approves the baseline (the same approvers as a bid decision, and the person who asked cannot approve unless the workspace allows it); the approved budget is locked.
- A later change is a new revision with a reason chosen from a list and its own approval; every revision stays readable and can be compared with the one before it.
- The budget, margin and costs are internal: they never appear on a customer document, a public link or the standard API, and the Talk to data source shows only header fields and totals.
- The Handover tab downloads an Excel file; sending to the ERP and reading back committed and actual cost are not available yet.
- The flag is set by a platform admin and needs GCC tender deals; a workspace without it sees no menu entry, screen or button.
