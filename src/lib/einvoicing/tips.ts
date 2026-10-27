// The explanations the Saudi e-invoice panel keeps behind an "i" (bpmsquarecore 6b): two sentences at most, 160 characters.
// One place so a test holds every text to the InfoTip limit. The screen never prints these as running text.

export const EINVOICE_TIPS = {
  panel: "The tax details ZATCA needs on this invoice. It is Ready when nothing is missing; sending it then gives it its number.",
  docType: "A buyer with a VAT number gets a Standard invoice, anyone else a Simplified one. You can switch while it is a draft.",
  vatCategory: "Standard is the usual 15%. Zero rated, Exempt and Out of scope lines are always 0% and need a reason.",
  byRate: "VAT is worked out once for each rate on the taxable amount, after any discount. Amounts are in whole halalas.",
  identity: "The UUID is fixed when the invoice is created. The counter number is taken when it is sent, one sequence per seller unit.",
  creditNote: "Corrects an issued invoice in full. The note copies its lines, links back to it and needs a reason.",
} as const;
