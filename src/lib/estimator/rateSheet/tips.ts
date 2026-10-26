// The explanations the rate-sheet import keeps behind an "i" (bpmsquarecore 6b). One place, so a test holds every text to the InfoTip
// limit: two sentences, 160 characters. The screen never prints these as running text.

export const RATE_SHEET_TIPS = {
  open: "Updates the cost of catalogue items from a supplier's price list in Excel or CSV. Nothing changes until you press Apply.",
  file: "An Excel (.xlsx) or CSV file up to 5 MB. It needs a header row with a rate column and an item name or SKU column.",
  asOf: "The date for rows that carry none. It decides how old a price is, so a price older than the validity days in Settings, RFQ is marked stale.",
  starterList: "A CSV with the SKU and name of every starter item in this catalogue and a blank rate. Send it to a supplier or fill it in yourself.",
  match: "A row matches on its SKU first, then on its name. A close name is only offered: you decide before anything is changed.",
  choice: "Update puts the rate on the catalogue item you pick. Add creates a new item, and Skip leaves the row out.",
  stale: "The price is older than the validity days in Settings, RFQ. It is still imported, and it shows as stale wherever it is used.",
  illustrative: "The starter templates price from placeholder costs marked illustrative. An item stops being illustrative when a rate sheet sets its rate.",
  currency: "A row in another currency is not applied, because the catalogue works in one currency. Convert the rates and import again.",
  history: "The rate a new one replaces is kept on the item and in the change history, with the date and where the new one came from.",
  notApplied: "A row in another currency, a repeat of an earlier row, or a currency that is not a three-letter code. Fix the sheet and import again.",
} as const;

export type RateSheetTipKey = keyof typeof RATE_SHEET_TIPS;
