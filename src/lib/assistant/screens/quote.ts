import type { ScreenOverlay } from "./types";

// Quotation detail (QuoteDetailLayout). Verbs and tasks only; the screen itself is generated from the object table.
export const QUOTE_DETAIL: ScreenOverlay = {
  id: "quote.detail",
  tabs: [
    { id: "overview", label: "Overview", what: "Lines, totals, the customer and linked records." },
    { id: "versions", label: "Versions", what: "Every revision of this quote; only the latest can be changed." },
  ],
  controls: [
    { id: "quote.status", label: "Status", does: "Moves the quote through your pipeline (Draft, Sent, ...)." },
    { id: "quote.outcome", label: "Outcome", does: "Records Open, Won, Lost or Dropped; Lost and Dropped ask for a reason." },
    { id: "quote.convert_invoice", label: "Convert to Invoice", does: "Raises an invoice from a won quote.", featureKey: "invoices", workcenter: "invoices", needs: "create" },
    { id: "quote.edit", label: "Edit quote", does: "Opens the quote form to change lines, prices and terms.", needs: "edit" },
    { id: "quote.new_version", label: "Create new version", does: "Copies this quote into an editable new version; this one becomes read-only.", needs: "edit" },
    { id: "quote.more", label: "More", does: "Opens the menu with PDF, CSV, Email, WhatsApp and Copy." },
    { id: "quote.menu_email", label: "Email quote", does: "Opens the email composer with the quote attached.", within: "quote.more" },
    { id: "quote.menu_pdf", label: "Download PDF", does: "Downloads the quote as it prints.", within: "quote.more" },
    { id: "quote.menu_whatsapp", label: "WhatsApp", does: "Opens WhatsApp with a message and the public PDF link.", within: "quote.more" },
    { id: "quote.menu_copy", label: "Copy quote", does: "Makes a brand-new quote from this one.", within: "quote.more", needs: "create" },
    { id: "quote.menu_standard_quote", label: "Create standard quote", does: "Makes a draft Standard Quote from this quotation's lines; the quotation is left as it is.", within: "quote.more", featureKey: "standard_quotes", workcenter: "standard_quotes", needs: "create" },
    { id: "tab:versions", label: "Versions tab", does: "Lists every revision of this quote." },
    { id: "tab:overview", label: "Overview tab", does: "Back to the quote's details." },
  ],
  tasks: [
    {
      id: "send", label: "Send this quote to the customer",
      steps: [
        { control: "quote.more", text: "Open the More menu." },
        { control: "quote.menu_email", text: "Choose Email quote, check the address and message, then send." },
        { control: "quote.status", text: "Set the status to Sent so the pipeline shows it." },
      ],
    },
    {
      id: "revise", label: "Change a quote that was already sent",
      steps: [
        { control: "quote.new_version", text: "Press Create new version. The old version turns read-only." },
        { control: "quote.edit", text: "Press Edit quote on the new version, change lines or prices, and save." },
      ],
    },
    {
      id: "win", label: "Record that the customer accepted",
      steps: [
        { control: "quote.outcome", text: "Set the outcome to Won." },
        { control: "quote.convert_invoice", text: "Press Convert to Invoice to raise the invoice." },
      ],
    },
    {
      id: "lose", label: "Record a lost quote",
      steps: [{ control: "quote.outcome", text: "Set the outcome to Lost or Dropped and pick the reason; it feeds loss reports." }],
    },
    {
      id: "share_pdf", label: "Give the customer a PDF",
      steps: [
        { control: "quote.more", text: "Open the More menu." },
        { control: "quote.menu_pdf", text: "Choose Download PDF, or WhatsApp to send a link." },
      ],
    },
    {
      id: "copy", label: "Start a new quote from this one",
      steps: [
        { control: "quote.more", text: "Open the More menu." },
        { control: "quote.menu_copy", text: "Choose Copy quote; the copy opens as a new draft." },
      ],
    },
  ],
  prerequisites: ["A contact or account with an email address, to send by email"],
};
