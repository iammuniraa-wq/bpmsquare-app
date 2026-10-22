import type { ScreenOverlay } from "./types";

// Settings > Integration middleware. The page files are owned elsewhere, so steps use the shared tab strip
// (tab:<id>) and plain instructions; controls on the page itself get a data-guide id when it is next touched.
export const SETTINGS_MIDDLEWARE: ScreenOverlay = {
  id: "settings.middleware",
  tabs: [
    { id: "links", label: "Links", what: "Which records are tied to which ERP records." },
    { id: "mapping", label: "Mapping", what: "How fields on each side line up." },
    { id: "monitor", label: "Monitor", what: "Messages sent and received, with failures and their stored error." },
    { id: "resync", label: "Resync", what: "Send records again or pull them again." },
  ],
  controls: [
    { id: "tab:links", label: "Links tab", does: "Shows which records are linked to the ERP." },
    { id: "tab:mapping", label: "Mapping tab", does: "Shows and edits how fields map." },
    { id: "tab:monitor", label: "Monitor tab", does: "Shows every message and why a failed one failed." },
    { id: "tab:resync", label: "Resync tab", does: "Sends or pulls records again." },
  ],
  tasks: [
    {
      id: "failed", label: "Find out why a sync message failed",
      steps: [
        { control: "tab:monitor", text: "Open the Monitor tab and find the failed message; its stored error says what the ERP answered." },
        { text: "Fix the cause (a missing link or a required field), then resend that message." },
      ],
    },
    {
      id: "resync", label: "Send records to the ERP again",
      steps: [
        { control: "tab:resync", text: "Open the Resync tab and choose the records to send again." },
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
      id: "links", label: "See whether a record is linked",
      steps: [{ control: "tab:links", text: "Open the Links tab and search for the record." }],
    },
  ],
  prerequisites: ["A connected ERP connection (set up on this same page)"],
};
