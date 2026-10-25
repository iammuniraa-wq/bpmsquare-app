// The explanations the contract project screens keep behind an "i" (bpmsquarecore 6b). One place, so a test (tips.test.ts) holds
// every text to the InfoTip limit: two sentences, 160 characters. The screens never print these as running text.

export const PROJECT_TIPS = {
  list: "The projects your won tenders became. Each has a cost budget that a manager approves before it is the baseline.",
  create: "Starts a project and its first budget from a won tender's lines. You can also make one by hand and add the lines yourself.",
  fromTender: "Copies the tender's lines into the baseline budget. A line with a recorded cost uses it; the rest start at the rate less your default margin and say estimated.",
  contractValue: "What the client pays under the contract. It starts as the awarded value, or the final bid total if no award value was recorded.",
  budgetVsContract: "The bar compares the budget with the contract value. What is left is the planned margin before any cost has been spent.",
  plannedMargin: "Contract value less the approved budget, and that as a percentage of the contract value.",
  costTypes: "The budget split by resource type: material, man power, sub contractor and so on. These are the ePROMIS resource levels.",
  attention: "Lines that need a person: costs that are only estimates, and lines with no cost code yet. None of them blocks approval except a missing resource type.",
  estimated: "The cost is a guess: the selling rate less your default margin. Type the real cost to turn it into a known cost.",
  resource: "What the money is spent on: material, asset, man power, sub contractor and so on. It follows the ePROMIS resource levels.",
  costCode: "Where in the work the money is spent, from your cost code list. Import the list in Settings, Contract projects.",
  wbs: "An optional work breakdown reference, for example the client's item number.",
  reserve: "A reserve line holds money back for risk or contingency. It counts in the total and is shown separately.",
  committed: "Ordered from suppliers or subcontractors. It will be read back from the ERP later, so it cannot be typed here.",
  actual: "Cost booked so far. It will be read back from the ERP later, so it cannot be typed here.",
  revisions: "Revision 0 is the baseline. After it is approved the budget is locked, and any change is a new revision with a reason and its own approval.",
  justification: "Why the budget changed. Pick a reason from the list; the reason Other needs a short note.",
  approval: "A manager approves the budget. The people who may approve are the same as for a bid decision, chosen in Settings, Tenders.",
  locked: "An approved budget cannot be edited. Start a new revision to change it.",
  diff: "Compares this revision with the approved one: lines added, removed or changed, and the change in total.",
  handover: "An Excel file with the project, its budget lines by resource and cost code, and the material list. Use it until the ERP connection is ready.",
  sendToErp: "Sending the project and budget to ePROMIS needs the connection, which is not set up yet. Download the Excel file for now.",
  defaultMargin: "The margin assumed for a tender line whose cost is not recorded, so its budget starts at the rate less this margin.",
  masters: "The lists a budget line points at. Import a file with a code, a name and optionally a parent code.",
  mastersDefaults: "These are starter lists, not your client's own. Import a file to replace or extend them; entries are matched on list and code.",
  mastersFile: "A CSV or Excel file with a header row: Code, Name and optionally Parent. Format the code column as text so leading zeros stay.",
  mastersParents: "A parent code that is not in the file or your list is dropped with a note, and the row is still stored.",
  erpId: "The project's number in the ERP. It is filled by the connection and cannot be edited here.",
} as const;

export type ProjectTipKey = keyof typeof PROJECT_TIPS;
