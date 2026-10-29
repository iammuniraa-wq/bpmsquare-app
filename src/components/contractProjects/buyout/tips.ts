// The explanations the Buy-out screens keep behind an "i" (bpmsquarecore 6b). One place, so a test (buyout.test.ts) holds every text to the
// InfoTip limit: two sentences, 160 characters. The screens never print these as running text.

export const BUYOUT_TIPS = {
  tab: "Decide who supplies each package, from the client's approved suppliers. The purchase order itself is raised in ePROMIS or your ERP.",
  group: "Only suppliers in this client's approved group can be asked. Without a group, every active supplier can be.",
  packagesTile: "How many packages exist and how many budget lines they hold. A line sits in one package at most.",
  budget: "The budget of the lines you put into packages. A line sits in one package at most.",
  committed: "The awarded price of each awarded package. Where it is over the budget you are warned, not stopped.",
  bestVsBudget: "Best valid quote of each package that has replies, against its budget. Plus is under budget, minus is over.",
  needsDecision: "Packages with at least one valid reply and no award yet.",
  newPackage: "A package groups budget lines you buy from one supplier or subcontractor. One supplier takes the whole package.",
  kind: "Supplier packages are goods; Subcontract packages are work. The kind is only a label for now.",
  costInBid: "What the line cost when the winning bid went in. It is internal and never shown to suppliers.",
  quotes: "Replies to the current request, side by side. The lowest valid price is marked; an expired or stale answer is marked in amber.",
  sendRequest: "Sends one request for the whole package. Every round is kept, and an earlier round is never deleted.",
  rounds: "Every request sent for this package, newest first, with who replied. They stay for audit after an award.",
  award: "One supplier takes the whole package. A price that is not the lowest valid one needs a reason, which is kept with the award.",
  unaward: "Takes the award back so another supplier can be chosen. A reason is required, and it is possible until the handover is marked sent.",
  bars: "The package budget against the best valid quote and the awarded price. Over budget is a warning, not a block.",
  handover: "An Excel with the supplier, lines, quantities, awarded rates and cost codes. Raise the purchase order in ePROMIS from it.",
  erpRef: "The order number from ePROMIS or your ERP, if you have it. Optional; the connection can fill it later.",
  progress: "How many packages are out, awarded and handed over, and the committed price against the budget. Open the Buy-out tab for the detail.",
  committedColumn: "The awarded price of the package this line is in. It shows once the package is awarded.",
} as const;

export type BuyoutTipKey = keyof typeof BUYOUT_TIPS;
