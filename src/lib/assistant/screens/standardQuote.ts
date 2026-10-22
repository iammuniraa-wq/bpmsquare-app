import type { ScreenOverlay } from "./types";

// Standard Quote detail (ObjectRecordPage). The main action and the menu entries change with the quote's status.
export const STANDARD_QUOTE_DETAIL: ScreenOverlay = {
  id: "standard_quote.detail",
  tabs: [
    { id: "overview", label: "Overview", what: "Customer, dates, totals and the deal it belongs to." },
    { id: "lines", label: "Lines", what: "Priced lines with quantity, rate and discount." },
    { id: "related", label: "Related", what: "Linked records such as supplier requests." },
    { id: "activity", label: "Activity", what: "Who changed what, and when." },
  ],
  controls: [
    { id: "record.primary", label: "Email to customer / Mark accepted", does: "On a draft it emails the quote; on a sent quote it marks it accepted." },
    { id: "menu:mark-as-sent", label: "Mark as sent", does: "Sets the status to Sent without emailing.", within: "record.more", needs: "edit" },
    { id: "menu:mark-rejected", label: "Mark rejected", does: "Sets the status to Rejected.", within: "record.more", needs: "edit" },
    { id: "menu:print-pdf", label: "Print / PDF", does: "Opens the quote as a PDF.", within: "record.more" },
    { id: "menu:edit", label: "Edit", does: "Opens the editor to price and change lines; drafts only.", within: "record.more", needs: "edit" },
    { id: "tab:lines", label: "Lines tab", does: "Shows the priced lines." },
    { id: "tab:activity", label: "Activity tab", does: "Shows the change history." },
  ],
  tasks: [
    {
      id: "send", label: "Send a draft to the customer",
      steps: [
        { control: "record.primary", text: "Press Email to customer; the customer gets the quote and it becomes Sent." },
      ],
    },
    {
      id: "accept", label: "Record that the customer accepted",
      steps: [{ control: "record.primary", text: "On a sent quote, press Mark accepted." }],
    },
    {
      id: "price", label: "Price or change the lines",
      steps: [
        { control: "record.more", text: "Open the three-dots menu." },
        { control: "menu:edit", text: "Choose Edit, change lines and prices, and save." },
      ],
    },
    {
      id: "reject", label: "Record that the customer declined",
      steps: [
        { control: "record.more", text: "Open the three-dots menu." },
        { control: "menu:mark-rejected", text: "Choose Mark rejected." },
      ],
    },
    {
      id: "print", label: "Get a PDF",
      steps: [
        { control: "record.more", text: "Open the three-dots menu." },
        { control: "menu:print-pdf", text: "Choose Print / PDF." },
      ],
    },
  ],
};
