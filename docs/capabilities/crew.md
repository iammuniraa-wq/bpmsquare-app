# crew
status: experimental
plain: AI automation. A workcenter of pre-built agents that watch the workspace, tell a person what needs attention and, only when a person approves, draft the next step. A gallery of tiles, one per agent.
rules:
- A platform admin switches it on in the tenant editor; each agent has its own flag as well, and with the flag off there is no menu entry, screen, cron work or cost.
- An agent only proposes. It never sends, edits or computes a price, an attendance total or any other number: it reads through our own engines and reports with links to the records it looked at.
- Anything that reaches a colleague opens an editor first and goes out only after a person presses Edit and send; there is no one-tap approval for text that reaches a person.
- A workspace admin switches each agent on or off and can pause all agents at once; a platform admin can also stop everything with an environment setting.
- Each agent has a monthly token allowance on top of the workspace's pooled AI allowance; the tightest wins, a spent allowance pauses the agent and never stops the plain screens.
- Every run keeps a trace of what the agent looked at, concluded, proposed and could not check; it is kept for a fixed number of days and then deleted.
- Agent output is not in global search, the standard API, the MCP server, webhooks or the Data Workbench.
