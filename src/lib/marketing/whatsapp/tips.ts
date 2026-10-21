// The explanations the WhatsApp number page and the Template Studio keep behind an "i"
// (docs/design/settings-simplification-marketing.md, batch M1). One place, so a test can hold every text to the
// InfoTip limit (two sentences, 160 characters). The screens never print these; they pass them to InfoTip.
// "Consent topic" is what a person agreed to hear about (docs/design/ux-simplification.md §3b L1).

export const WA_SETUP_TIPS = {
  provider: "Only the sandbox is available for now. It logs every message and sends nothing anywhere.",
  number: "The WhatsApp number customers see. Stored encrypted; only the last three digits are ever shown again.",
  replies: "Your provider calls this address with replies and delivery updates, signed with the secret. A STOP reply withdraws consent at once; START records it again.",
  match: "So a reply from someone you have not messaged yet, such as a START, can be matched to their record. Only a scrambled fingerprint of each number is kept.",
} as const;

export const WA_TEMPLATE_TIPS = {
  basics: "Your team's name for it, the language, and what kind of message it is.",
  language: "Write English first. For another language, make a second template with the same name.",
  message: "What the person reads. Details in double braces are filled in for each person.",
  addDetail: "A message cannot start or end with a detail, so add a few words before and after.",
  topic: "The consent topic this message is about. Only people who agreed to it on WhatsApp are sent it.",
  consentTopic: "Consent is checked again at the moment of sending. A person who replies STOP is never sent another.",
  approval: "WhatsApp must approve a template before you can start a conversation with it. Here you set the status yourself, once your provider has approved it.",
  providerName: "The name you registered the template under, if it differs. Letters, numbers and underscores.",
} as const;
