// The explanations the Bill of quantities keeps behind an "i" (bpmsquarecore 6b), apart from the older BOQ texts in lib/tender/tips.ts.
// Held to the InfoTip limit (two sentences, 160 characters) by tips.test.ts next to it. The screen never prints these as running text.

export const BOQ_TABLE_TIPS = {
  table: "One row per line of the client's BOQ, with their own item numbers. Open a row to change its quantity or rate and to see where its cost came from.",
  chips: "Estimate and RFQ name what the cost comes from. Unpriced has no rate yet; Stale means the price is older than your workspace's limit.",
  rate: "A rate typed here is saved as Manual and keeps the source it replaced. To change a supplier or estimate cost, use Costing.",
  costing: "Suppliers are compared and awarded in Costing only. Open it to see the replies for this row and to build up a rate from an estimate.",
  sourcesList: "Prices found for this line in your product costs, past projects and the client's file. A stale one is used only if you choose it knowingly.",
  filters: "Unpriced rows have no rate. Stale rows have a supplier or past-project price older than your workspace's limit.",
  markup: "Markup on cost for Price all. Supplier and BOM figures are costs, so the rate is the cost plus this markup; past-project and client rates are used as they are.",
  total: "The priced rows added up at their rates, which already include the markup on cost.",
  priced: "Lines that have a selling rate. The rest still need a cost from Costing or a rate typed in the row.",
  source: "Where the cost behind the rate came from: an estimate, an awarded RFQ, a past project, the client's file or a hand-typed figure.",
  cost: "Your internal cost per unit. It never reaches the priced BOQ, the answer sheet or a bid version.",
  product: "The catalog product this line is tied to, so supplier and BOM prices can find it. Link it in Match.",
  stale: "The price is older than your workspace's validity days. It is only used when you choose it knowingly.",
} as const;

export type BoqTableTipKey = keyof typeof BOQ_TABLE_TIPS;
