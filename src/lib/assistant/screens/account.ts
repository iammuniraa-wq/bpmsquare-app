import type { ScreenOverlay } from "./types";

// Account detail (ObjectRecordPage). Tabs follow the modules the workspace owns.
export const ACCOUNT_DETAIL: ScreenOverlay = {
  id: "account.detail",
  tabs: [
    { id: "overview", label: "Overview", what: "The account's details and, on some themes, its relationship map." },
    { id: "cases", label: "Cases", what: "Service cases for this account.", featureKey: "cases" },
    { id: "contacts", label: "Contacts", what: "People at this account.", featureKey: "contacts" },
    { id: "assets", label: "Assets", what: "Equipment this account owns.", featureKey: "assets" },
    { id: "quotations", label: "Quotations", what: "Quotes raised for this account.", featureKey: "quotations" },
    { id: "invoices", label: "Invoices", what: "Invoices and balances due.", featureKey: "invoices" },
    { id: "activity", label: "Activity", what: "Notes, calls and changes over time." },
  ],
  controls: [
    { id: "account.360", label: "Account 360", does: "Opens the side drawer with the health rating, next steps and every card about this account." },
    { id: "tab:contacts", label: "Contacts tab", does: "Lists the people at this account.", featureKey: "contacts", workcenter: "contacts" },
    { id: "tab:quotations", label: "Quotations tab", does: "Lists this account's quotes.", featureKey: "quotations", workcenter: "quotations" },
    { id: "tab:cases", label: "Cases tab", does: "Lists this account's service cases.", featureKey: "cases", workcenter: "cases" },
    { id: "related.new", label: "+ New (on a tab)", does: "Starts a new record of the open tab's kind, already linked to this account.", needs: "create" },
  ],
  tasks: [
    {
      id: "edit", label: "Change the account's details",
      steps: [
        { control: "menu:edit", text: "Open the three-dots menu and choose Edit; the Details card becomes inputs." },
        { control: "record.save_details", text: "Change the fields and press Save." },
      ],
    },
    {
      id: "add_contact", label: "Add a contact to this account",
      steps: [
        { control: "tab:contacts", text: "Open the Contacts tab." },
        { control: "related.new", text: "Press + New Contact; the account is already filled in." },
      ],
    },
    {
      id: "start_quote", label: "Start a quotation for this account",
      steps: [
        { control: "tab:quotations", text: "Open the Quotations tab." },
        { control: "related.new", text: "Press + New Quotation; the account is already filled in." },
      ],
    },
    {
      id: "open_case", label: "Open a service case",
      steps: [
        { control: "tab:cases", text: "Open the Cases tab." },
        { control: "related.new", text: "Press + New Case; the account is already filled in." },
      ],
    },
    {
      id: "overview", label: "See everything about this account at once",
      steps: [{ control: "account.360", text: "Press Account 360 to open the drawer with its rating and next steps." }],
    },
  ],
};
