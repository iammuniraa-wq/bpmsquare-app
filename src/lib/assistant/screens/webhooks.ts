import type { ScreenOverlay } from "./types";

// Settings > Webhooks. The page files are owned elsewhere, so steps here use the shared tab strip (tab:<id>) and
// plain instructions; controls on the page itself get a data-guide id when that screen is next touched.
export const SETTINGS_WEBHOOKS: ScreenOverlay = {
  id: "settings.webhooks",
  tabs: [
    { id: "basics", label: "Basics", what: "Name, kind (change-feed events or a call) and the address." },
    { id: "request", label: "Request", what: "Headers and the message body." },
    { id: "security", label: "Security", what: "The signing secret and who may see it." },
    { id: "test", label: "Test", what: "Send a sample request and read the answer." },
    { id: "log", label: "Log", what: "Recent deliveries and failures." },
  ],
  controls: [
    { id: "tab:basics", label: "Basics tab", does: "Name, kind and address of the webhook." },
    { id: "tab:request", label: "Request tab", does: "Headers and message body." },
    { id: "tab:security", label: "Security tab", does: "The signing secret." },
    { id: "tab:test", label: "Test tab", does: "Sends a sample request." },
    { id: "tab:log", label: "Log tab", does: "Shows recent deliveries and failures." },
  ],
  tasks: [
    {
      id: "add", label: "Add a webhook",
      steps: [
        { text: "Press the add button at the top of the list; a panel opens on the right." },
        { control: "tab:basics", text: "Give it a name, pick what fires it, and enter the https address." },
        { control: "tab:request", text: "Set headers and the body if the receiver needs a particular shape." },
        { control: "tab:test", text: "Send a test and read the answer before relying on it." },
      ],
    },
    {
      id: "failing", label: "Find out why a webhook is failing",
      steps: [
        { text: "Click the webhook in the list to open its panel." },
        { control: "tab:log", text: "Open the Log tab and read the last error; resume the webhook if it paused." },
      ],
    },
    {
      id: "sign", label: "Check the signature on the receiver",
      steps: [
        { text: "Click the webhook in the list to open its panel." },
        { control: "tab:security", text: "Open the Security tab for the signing secret and how requests are signed." },
      ],
    },
  ],
};
