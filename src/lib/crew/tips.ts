// The explanations the AI automation screens keep behind an "i" (bpmsquarecore 6b). One place, so a test (tips.test.ts) holds every text to
// the InfoTip limit: two sentences, 160 characters. The screens never print these as running text.

export const CREW_TIPS = {
  page: "Agents watch your workspace and suggest the next step. They only suggest: a person approves everything that reaches someone.",
  pauseAll: "Stops every agent at once, between steps. Suggestions already made stay, and you can still approve or reject them.",
  review: "Suggestions from your agents, most urgent first. Open Why to see what each one looked at.",
  runs: "Every time an agent looked, and what came of it. Open a run to see exactly what it read and concluded.",
  settings: "Switch the agent on, choose when it looks and how sensitive it is. Changes apply to the next run.",
  onOff: "Off by default. Switched on, the agent looks at the time you set and tells you only what needs attention.",
  when: "The time of day, in your workspace's own clock, and the days it looks. A day with nothing to report costs nothing.",
  sensitivity: "Quiet speaks up only when fairly sure, and Thorough also raises early signs. Balanced sits between the two.",
  watchWindow: "Tenders closing within this many days are looked at. Closer ones are always looked at.",
  digest: "A daily e-mail to you alone with what is open. It never goes to anyone else.",
  allowance: "Tokens this agent has used this month against its cap. When it is spent the agent pauses; your normal screens keep working.",
  why: "What the agent looked at and which part of it led to this suggestion. Each chip opens the record.",
  notAnIssue: "Silences this same situation for 30 days. It comes back sooner only if it gets worse.",
  dismiss: "Not now. It returns tomorrow if it is still true.",
  editSend: "Edit the note, then send it as your own. Nothing is sent until you press Send.",
  trace: "Everything this run read, concluded, proposed and could not check. Numbers come from your records, never from the AI.",
  tokens: "Tokens are the units AI use is counted in. Your monthly allowance is shared with other AI features.",
  comingSoon: "Planned agents. They are not active and no data is read for them.",
} as const;
