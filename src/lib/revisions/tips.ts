// The explanations of the revision screens (bpmsquarecore 6b): behind an "i", two sentences at most, held to the limit by a test.

export const REVISION_TIPS = {
  issue: "Say what changed since the last revision. It is kept with the revision and cannot be edited.",
  revise: "The quotation reopens as the next revision. The revisions already issued stay exactly as they were sent.",
  issueFirst: "Issuing locks this quotation as Rev. 00. Use Revise later to change anything.",
  tab: "Every issue is kept as it was printed, with its price and its PDF. A revision cannot be changed or removed.",
  copy: "Copy makes a new quotation with a new number. Revise changes this offer and keeps its number.",
} as const;
