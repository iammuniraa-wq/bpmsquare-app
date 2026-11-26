// The "i" on a change card or a tender step card: what pressing the button does, in two short sentences (rule 6b, at most
// 160 characters). Kept in one place so the test that holds them to the limit sees every one.

export const CARD_TIPS = {
  update: "Shows what the record holds now and what it will hold. Nothing changes until you press Save changes.",
  decision: "Sends your go or no-go, with your reason, to the people who approve bid decisions. They decide it on the deal.",
  submit_bid: "Saves the deal's lines as the next bid version and moves the tender to Submitted. A version is never edited afterwards.",
  rfq: "Makes a draft RFQ from the lines that have no price and adds these suppliers. Nothing is sent to them until you send it from the RFQ.",
  estimate: "Makes an estimate on this tender from the template and the values you gave. Anything you leave out takes the template's default.",
  match: "Links BOQ lines to catalog products where the match is strong and clear. Weaker matches stay for you to pick.",
  price: "Prices the lines that have no price from fresh supplier, BOM or past-project prices, adding this markup to costs. Other lines stay unpriced.",
} as const;

export type CardTipKey = keyof typeof CARD_TIPS;
