// The explanations the Process Design Studio keeps behind an "i" (docs/design/ux-simplification.md §3 row 4).
// One place, so a test can hold every text to the InfoTip limit (two sentences, 160 characters). The screens never
// print these; they pass them to the shared InfoTip. A hint that only repeated its label was deleted, not moved.

export const STUDIO_TIPS = {
  // Tell us
  areas: "Tap an area to answer three short questions. Switch off what does not apply.",
  docs: "SOPs, diagrams, spreadsheets, an old fit-gap list.",
  studioOptions: "The language we talk in, and how much we ask back.",
  language: "The language the studio talks to you in. English for now; Arabic is planned.",
  followUps: "Up to three short questions after each answer. Off means you just type and we map what you wrote.",
  buildMapAgain: "Use this after you add more to the conversation. It replaces the steps you have edited.",
  tellHead: "In your own words; nothing is analysed until you press Build my process map. Blue chips are what you said, amber what we assumed.",
  // Your process
  roles: "The people who do the work, one row each. Each role is a lane on the map.",
  addRole: "Name it the way you call the job, for example Yard supervisor.",
  showAssumed: "Steps we added because the order needed them. Dashed border; remove any that are wrong.",
  showHandOvers: "An arrow where a step passes work to another role.",
  addStepGroup: "Something we missed. You name it and say how it is done today.",
  stepArea: "Which part of the business it belongs to.",
  stepName: "A short verb phrase, for example Send the quote.",
  stepHow: "Email, Excel, WhatsApp, an ERP, paper.",
  processHead: "Drafted from what you told us. Change any step name or role; it is your map.",
  // How BPMSquare fits
  fitShow: "Pick which lines to see. All are on by default.",
  fitMore: "Technical ids for your IT team, and re-checking after edits.",
  catalogueIds: "The technical id behind each named module or screen. Off for most people; on for your IT team.",
  recheck: "After you change the map. The old result is kept as a version.",
  fitHead: "One line per step. Open a line for the why, and tap any name to see exactly what it is.",
  // What we would change
  kinds: "The only five kinds there are. Untick a kind to hide those cards.",
  changesMore: "Hidden cards, and changes you add yourself.",
  showHidden: "Cards you marked we can live without this stay listed, greyed out.",
  addChange: "Something you want that we did not list. Plain words are fine.",
  proposeAgain: "Rework the cards we proposed from the current fit report. Changes you added stay.",
  changesHead: "One card for every partly or not covered line. Hide any you can live without.",
  // Plan
  dates: "Start date and weekend; every date in the plan follows.",
  startDate: "When you would like to begin. Every date in the plan moves with it.",
  weekend: "Days we skip when counting working days.",
  onlyMine: "Hide BPMSquare's tasks and see just what your team has to do.",
  planMore: "Starting over from the standard plan.",
  buildPlanAgain: "Starts from the standard plan again. Tasks you added yourself stay; ticks are cleared.",
  planHead: "Phases, tasks and who does what. Tick a phase when it looks right, change a duration, leave a comment anywhere.",
  timeline: "Phases run one after another, so changing a duration moves the dates. A diamond marks a milestone; dates are indicative.",
  // Talk to us
  contactName: "Who we should ask for when we call.",
  contactEmail: "We reply here within two working days.",
  download: "The same package for your own team. A Google Doc version comes with the next release.",
  pdf: "The whole package, marked Indicative on every page and confirmed on the call.",
  talkHead: "Here is your package. Send it and someone from BPMSquare calls you back.",
} as const;

/** Dynamic: the send group's explanation names the version this send will freeze. */
export const sendTip = (version: number): string =>
  `Freezes version ${version} of your study and sends it to us. You can keep editing; the next send makes version ${version + 1}.`;
