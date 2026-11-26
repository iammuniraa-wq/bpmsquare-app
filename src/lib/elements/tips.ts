// The explanations the buildings and elements screens keep behind an "i" (bpmsquarecore 6b). One place, so tips.test.ts holds every text to the
// InfoTip limit: two sentences, 160 characters. The screens never print these as running text.

export const ELEMENT_TIPS = {
  buildings: "A building is a top-level WBS item with a short code. Its activities sit under it, and its lines roll up into it.",
  buildingCode: "1 to 6 letters or digits, such as B01. Element codes are built from it, so it cannot change once codes are issued.",
  common: "Site-wide items such as transport sit here, outside any real building. It is made when you ask for it.",
  noBuilding: "Lines in no building yet. Put them in one with Group into WBS; they stay as they are until then.",
  elementType: "What kind of piece the line is, from your Element types list in Settings, Contract projects.",
  elementCode: "One code for one contract line. We issue it from your pattern, or you type the client's own, and it is unique on the project.",
  issue: "Gives every line that has a building and a type its next code. Lines that already have one are skipped, and numbers are never reused.",
  pattern: "How issued codes are built: {building}, {type} and {seq:4} (a running number), joined by - . _ or /. A change only affects new projects.",
  codeLimit: "The longest an element code may be. Match the item-number length of your ERP.",
  outsidePattern: "The client's own code does not follow your pattern. It is kept exactly as typed; this is a heads-up, not an error.",
  clientQty: "The contracted quantity, copied from the client's BOQ when the project was made. It only changes through a client variation.",
  modelQty: "What the model or the drawings say. It sits beside the client quantity and moves the budget only when you accept it.",
  budgetUses: "Client means the budget quantity is the contracted one. Model means you accepted the model's number into this line.",
  variance: "Model minus client, in quantity, percent and money at the client rate. It shows what the contract would carry if remeasured.",
  tolerance: "A line within this percent of the client quantity is fine. Over it is amber, and over twice it is red.",
  levelNames: "What your workspace calls the WBS levels: a building can be an Area or a Phase. It changes the words only.",
  reissue: "Renames the codes of one building after its code changed. Only possible before the baseline is approved and before anything reaches the ERP.",
  locked: "An approved budget is locked. Start a revision to change an element, with a reason.",
  comparison: "Sets what the model says beside the budget. Nothing changes until you tick rows and apply them.",
  modelRows: "Same rows are hidden. A row in the budget but not in the model is flagged, never deleted or set to zero.",
  applyModel: "Before the baseline is approved this writes to revision 0. After it, it starts a draft revision with a reason.",
  variation: "A change that is extra work for the client is not decided here. Raise a client variation; the contract value only moves there.",
  elementTypes: "The kinds of piece your workspace builds. A code is never renamed, only switched off, so codes already issued stay valid.",
} as const;

export type ElementTipKey = keyof typeof ELEMENT_TIPS;
