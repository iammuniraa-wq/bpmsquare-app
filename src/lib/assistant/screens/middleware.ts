import type { ScreenOverlay } from "./types";

// Settings > Integration middleware. Ids: middleware.* are carried by the page's own components; tab:<id> by the shared
// tab strip. A control on a tab names that tab, so the overlay opens it first. Test and Edit live in the connection
// panel behind the open connector chip, so they point at the chip when the panel is closed. The page is admin-only.
export const SETTINGS_MIDDLEWARE: ScreenOverlay = {
  id: "settings.middleware",
  tabs: [
    { id: "links", label: "Links", what: "Which records are tied to which ERP records." },
    { id: "mapping", label: "Mapping", what: "How fields on each side line up." },
    { id: "monitor", label: "Monitor", what: "Messages sent and received, with failures and their stored error." },
    { id: "resync", label: "Resync", what: "Send records again or pull them again." },
  ],
  controls: [
    { id: "middleware.connector", label: "Connector chips", does: "Pick the ERP connection; clicking the open chip shows its connection panel.", needs: "admin" },
    { id: "middleware.connect", label: "Connect", does: "Opens the sign-in form when the connector has no connection yet.", needs: "admin" },
    { id: "middleware.test", label: "Test", does: "Checks the connection and shows one result line.", needs: "admin", within: "middleware.connector" },
    { id: "middleware.edit", label: "Edit", does: "Shows the sign-in fields of the connection.", needs: "admin", within: "middleware.connector" },
    { id: "tab:links", label: "Links tab", does: "Shows which records are linked to the ERP." },
    { id: "tab:mapping", label: "Mapping tab", does: "Shows and edits how fields map." },
    { id: "tab:monitor", label: "Monitor tab", does: "Shows every message and why a failed one failed." },
    { id: "tab:resync", label: "Resync tab", does: "Sends or pulls records again." },
    { id: "middleware.link_row", label: "A row in Links", does: "Opens the panel to change what that record becomes in the ERP.", tab: "links" },
    { id: "middleware.scope_edit", label: "Scope Edit", does: "Opens the panel to narrow which records an entity syncs.", tab: "resync", needs: "admin" },
    { id: "middleware.restart", label: "Restart", does: "Sends the ticked failed messages again.", tab: "monitor", needs: "admin" },
    { id: "middleware.view_request", label: "View request", does: "Shows the body that was sent for the one ticked message.", tab: "monitor" },
    { id: "middleware.view_response", label: "View response", does: "Shows what the ERP answered for the one ticked message.", tab: "monitor" },
  ],
  tasks: [
    {
      id: "failed", label: "Find out why a sync message failed",
      steps: [
        { control: "tab:monitor", text: "Open the Monitor tab and tick the failed message; its Why line shows the stored error." },
        { control: "middleware.view_response", text: "Press View response to read exactly what the ERP answered." },
        { control: "middleware.view_request", text: "Press View request to see what was sent, if the answer points at the data." },
        { control: "middleware.restart", text: "Fix the cause (a missing link or a required field), then press Restart." },
      ],
    },
    {
      id: "connection", label: "Check or change the ERP connection",
      steps: [
        { control: "middleware.connector", text: "Click the open connector chip to show its connection panel." },
        { control: "middleware.test", text: "Press Test for a one-line result." },
        { control: "middleware.edit", text: "Press Edit to change the sign-in fields." },
      ],
    },
    {
      id: "connect", label: "Connect an ERP for the first time",
      steps: [{ control: "middleware.connect", text: "Press Connect and sign in once; quotes, customers and products then move between the two." }],
    },
    {
      id: "resync", label: "Send records to the ERP again",
      steps: [
        { control: "tab:resync", text: "Open the Resync tab and choose the records to send again." },
        { control: "middleware.scope_edit", text: "Press Edit in the Scope column first if only some records should go." },
        { control: "tab:monitor", text: "Watch the Monitor tab to see them go through." },
      ],
    },
    {
      id: "mapping", label: "Change how a field maps",
      steps: [
        { control: "tab:mapping", text: "Open the Mapping tab, pick the object, and change the field pair." },
      ],
    },
    {
      id: "links", label: "See or change what a record becomes in the ERP",
      steps: [
        { control: "tab:links", text: "Open the Links tab." },
        { control: "middleware.link_row", text: "Click the row of the record kind; its panel opens on the right." },
      ],
    },
  ],
  prerequisites: ["A connected ERP connection (set up on this same page)"],
};
