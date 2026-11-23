# project_dashboards
status: live
plain: Project cost and profitability dashboards. A Health card on each contract project (margin, cash and delivery lights, with their words), a Forecast tab (cost against budget, cost by category with the project manager's estimate to go, and the margin bridge), six dashboard blocks and a Reports table. The planned half works from the budget, client changes, billing plan and buy-out; every figure that needs the ERP says Not connected until a cost read-back exists.
rules:
- It needs Contract projects and is switched on per workspace by the platform admin; with it off nothing changes on any screen.
- Cost and margin are internal: who sees them is a workspace setting (everyone who can open Contract projects, or only admins, people granted Project cost and margin, and a project's own manager), and it is enforced where the figures are made.
- A figure that needs the ERP is never shown as 0: it says Not connected with one next step, and a real 0 appears only after a read-back that held nothing.
- The estimate to go is typed by the project manager per cost cell (WBS item and resource type); an empty box means the budget is assumed to hold, and that share of the forecast is always shown as an estimate.
- Cost and margin never appear on the API, MCP, Data Workbench, Talk to data, the outbound change feed or a customer document.
