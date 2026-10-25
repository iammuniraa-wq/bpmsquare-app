// The explanations the Company screen keeps behind an "i" (bpmsquarecore 6b). One place so a test holds every text
// to the InfoTip limit (two sentences, 160 characters). The screen never prints these as running text.

export const COMPANY_TIPS = {
  page: "Your company details, legal entities, tax and currency, and how IDs are numbered. Changes apply to new documents; existing ones keep what they were made with.",
  name: "Shown in the sidebar header and printed on quotations and invoices.",
  printName: "This letterhead already used a different name. Clear the box to print the company name instead.",
  logo: "Printed on quotations and invoices. PNG, JPG or WebP, up to 2 MB.",
  taxId: "Your GSTIN or VAT number, printed on documents.",
  tagline: "A short line under the company name on the letterhead.",
  logoBg: "Used when no logo is uploaded: the company's initials appear on this colour.",
  undertaking: "A strip in the letterhead header, for example the work you do.",
  footerTagline: "A line at the bottom of every printed document.",
  phones: "Each number prints in the footer as a labelled column, for example Commercial or Work.",
  accreditations: "Certification logos, for example ISO or EGAC, shown top left of the quote letterhead. They replace the old ISO text.",
  partners: "Brand logos, for example ABB or Siemens, shown top right of the quote letterhead.",
  oldIso: "Plain text used only while no accreditation logo is added.",
  entities: "Add one for each legal body that issues quotes. The default one is picked on new quotations.",
  einvoiceSeller: "What ZATCA needs to see about the seller on every e-invoice. Each entity is one seller unit with its own invoice counter.",
  vatNumber: "15 digits, starting and ending with 3. When empty, the Tax ID above is used.",
  entityBlank: "Quotations use the company details until an entity is added.",
  currency: "How every amount is shown, printed and emailed. It relabels figures; it does not convert them.",
  taxLabel: "The name printed beside the tax line, for example GST, VAT or MwSt.",
  inclusive: "On when your rates already include tax. Off adds tax on top of each rate.",
  quoteTemplate: "Tokens: {PREFIX} {YYYY} {YY} {MM} {SEQ}. A new format applies to new quotations only.",
  quoteDigits: "How many digits the running number has, from 2 to 6.",
  quoteReset: "Start again from 1 each year, or keep counting.",
} as const;
