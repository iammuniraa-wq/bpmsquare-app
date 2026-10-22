# ai_assistant_web
status: experimental
plain: The assistant can search the web for facts about a company, but only after the person says yes to that exact search, and it answers with the sources it used.
rules:
- Switched on per workspace by a platform admin and only with the AI assistant; until then the assistant has no way to search and says so.
- The assistant asks first with the search written out, and the person answers Yes, No or Always in this chat; "Always" lasts for that chat only and is never remembered for the person.
- Only companies are researched: a person, an email address or a phone number is never searched, and the search may contain only words the person typed or the name of the open account or supplier, never data from the workspace.
- What comes back is treated as data, never as instructions: after a web result the assistant can no longer open screens, query data or change anything for the rest of that question.
- The answer carries a From the web label and links to its https sources; if nothing could be cited it says it could not verify anything.
- Each search counts against the monthly AI allowance (the tokens plus a flat charge per search), is limited to one per question and 20 per person per day, and leaves an audit row once the database update has been applied.
- A workspace can switch external calls off in its own policy, which keeps web research off whatever the platform flag says.
