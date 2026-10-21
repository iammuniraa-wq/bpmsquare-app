// The explanations Settings -> Marketing -> Consent topics keeps behind an "i" (docs/design/ux-simplification.md
// §3 row 11). One place, so a test can hold every text to the InfoTip limit (two sentences, 160 characters).

export const CONSENT_SETTINGS_TIPS = {
  page: "Every yes and no is kept as a record, with when and how it was given. Until someone says yes, nobody is emailed unless you choose otherwise.",
  topics: "People can agree to some consent topics and refuse others. A topic people have already answered can be renamed but not removed.",
  topicName: "What people see when they choose.",
  topicCovers: "One line under the name, so people know what they are agreeing to.",
  defaults: "For a person with no recorded answer, choose whether they can still be emailed. The safe choice is that they cannot.",
} as const;

/** Shown as an amber line, and only while at least one country group relies on the relaxed option. */
export const RELAXED_WARNING = "You have allowed emailing existing customers who never said yes. Ask your legal adviser, as the rule differs for each country.";
