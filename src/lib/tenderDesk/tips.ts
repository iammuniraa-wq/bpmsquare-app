// The explanations behind the "i" on the tender blocks (6b: no running text on the screen). Held to the shared limit (two sentences, 160
// characters) by tipTextProblems in tips.test.ts.

export const TENDER_BLOCK_TIPS = {
  byStage: "Open tenders only. The bar is the value in millions, the figure in brackets is the number of tenders.",
  closing: "Red is three days or less, amber is ten days or less, green is later. A row opens the tender.",
  wonLost: "Tenders decided in each of the last 12 months. A column opens the tenders decided that way in that month.",
  clients: "The five largest clients by open value, then everything else together. A slice opens that client's tenders.",
  attention: "Things only a person can move, most urgent first. A row opens the record.",
  trend: "Open value rebuilt week by week from each tender's created and closed dates. Later edits to an amount are not replayed.",
  deadlines: "Each marker is a bid end date. Red is three days or less, amber is ten days or less, green is later.",
  buyout: "The bar is the budget, the marker is the best quote, the filled part is what is awarded.",
} as const;

export const DASH_LOOK_TIP = "Bold is the light dashboard and Control room turns it dark. Your choice is remembered for you.";
