// The explanations the Inbox screens keep behind an "i" (bpmsquarecore 6b). One place, so a test (tips.test.ts) holds
// every text to the InfoTip limit: two sentences, 160 characters. The screens never print these as running text.

export const INBOX_TIPS = {
  page: "Mail from the addresses your team reads. Open one to answer it, or turn it into a Quote, Project, Case, Lead or Estimate.",
  channel: "Each address is a channel with its own team. You see only the channels you are on the team of.",
  status: "New is waiting for someone. Handled is dealt with, and Spam is hidden from New.",
  files: "Each file is labelled by whether it can be measured from. Poor or Needs review means ask for a PDF or DXF.",
  quality: "Good is a PDF, DXF, Word or Excel file. Needs review is a photo or scan, and Poor a DWG or a tiny picture.",
  assign: "Gives the message to one person on this address's team. It shows in their morning briefing.",
  create: "Makes the record from this email, copies its files onto it and marks the email handled. The address's favourite is listed first.",
  reply: "Goes only to the person who wrote, from this address, and stays in the conversation. A demo workspace sends nothing to a customer.",
  retention: "An email that became a record keeps its text 30 days, one that did not 90 days. Then only the sender, subject and record remain.",
  linked: "The record this email became. Its files were copied onto it, so they stay when the email is cleared.",
  channelPage: "The addresses customers write to. Forward your company mail to an address, or connect the mailbox it should be read from.",
  address: "Forward mail to this address, or put it on your website. Anyone who knows it can write to it, so change it if it leaks.",
  team: "Only these roles, and admins, see and answer this channel's mail. Leave it empty for everyone who can open the Inbox.",
  defaultAction: "What the Create menu lists first for this address, so the common step is one tap.",
  defaultTemplate: "The estimate template to open first when an email becomes an estimate. You can still switch it.",
  mailbox: "Reads the company's own Gmail or mail server into this channel. Nothing in the mailbox is marked read, moved or deleted.",
  replyFrom: "With a mailbox, replies go from the mailbox. Otherwise they go from BPMSquare's sender, with this name, and answers return to this address.",
  rotate: "Makes a new address and stops the old one working. Anything still forwarding to the old address is lost until you update it.",
  filterSenders: "Only mail from these addresses or domains is taken in, for example buyer@ministry.gov.sa or @ministry.gov.sa. Leave empty to take mail from anyone.",
  filterSubjects: "Only mail whose subject has one of these words is taken in, for example tender, RFQ. A matching sender or word is enough; the rest stays in the mailbox.",
  paused: "A paused channel takes in no new mail. Its old mail stays readable until it is cleared.",
} as const;

export type InboxTipKey = keyof typeof INBOX_TIPS;
