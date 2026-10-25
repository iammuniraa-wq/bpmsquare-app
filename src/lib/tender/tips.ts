// The explanations the tender screens keep behind an "i" (bpmsquarecore 6b). One place, so a test (tips.test.ts) holds every
// text to the InfoTip limit: two sentences, 160 characters. The screens never print these as running text.

export const TENDER_TIPS = {
  tab: "Tenders are deals with a closing date, their own stages and a recorded bid decision. They never appear on the Deals board.",
  closingSoon: "Open tenders that close within 14 days, soonest first. Red is under 2 days or past, amber is under 7.",
  newTender: "Starts a deal and its tender details together. Only the account is required; fill in the rest when you have it.",
  tenderNo: "The number the issuer gave this tender. It must be unique in your workspace.",
  issuer: "Who issued the tender, as written on the documents. Link an account if you also do business with them.",
  portal: "Where the tender documents and your answer travel: a portal such as Ariba, email, or an Excel sheet.",
  closing: "When the issuer stops accepting bids. Reminders go to the owner and team 7, 3 and 1 days before and on the day.",
  source: "How this tender reached you. Use Other for an invitation by phone or a meeting.",
  decision: "A team member proposes go or no-go with a reason. An approver decides, and the deal cannot move on without that approval.",
  approvers: "Pick the people who may approve a bid or no-bid proposal. Leave it empty and every workspace admin can.",
  selfApproval: "When on, a proposer may approve their own proposal. Switch it on in a one-admin workspace, or no one can approve.",
  recordedBefore: "This decision was saved before approval was required. It does not open the next stage; propose it again to get approval.",
  bondRelease: "Release the bond once the issuer has handed it back. Expiry warnings and bond lines in reminders then stop.",
  bond: "The bid bond the issuer asks for with the offer. The expiry shows when the guarantee must be valid until.",
  addenda: "How many addenda or amendments the issuer has sent. Raise it each time one arrives.",
  stage: "Tender stages are separate from the Deals stages. Awarded, Lost and No-bid close the tender.",
  room: "A private place for your team to discuss this bid. Only people in your workspace can see it.",
  roomQuestion: "A question has an owner and a due date. It stays open until someone marks it answered.",
  roomDecision: "Pin a one-line decision so everyone sees what was agreed, in the order it was agreed.",
  roomMembers: "The owner and team are added automatically. Members see an unread count and get an email summary, at most every 15 minutes.",
  roomFiles: "Attach PDF, Office, DXF, CSV, text or picture files: up to 5 per message and 15 MB each.",
  roomQuestionsLink: "Open questions in the Deal Room for this tender. Open the room to answer them.",
  reminders:"Reminders go by email to the owner and team and are logged under Outbound emails. Changing the closing date restarts them.",
} as const;

export type TenderTipKey = keyof typeof TENDER_TIPS;
