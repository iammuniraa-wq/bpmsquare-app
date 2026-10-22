import type { ScreenOverlay } from "./types";

// Settings > Webhooks. Ids: webhooks.* are carried by WebhooksClient and WebhookPanel; tab:<id> by the shared tab strip
// inside the side panel (it exists once a row or "New webhook" has opened the panel). The page is admin-only.
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
    { id: "webhooks.new", label: "New webhook", does: "Opens the side panel to create a webhook.", needs: "admin" },
    { id: "webhooks.row", label: "A webhook in the list", does: "Opens that webhook's side panel with its tabs." },
    { id: "webhooks.save", label: "Create / Save", does: "Saves the webhook (Create for a new one).", needs: "admin" },
    { id: "tab:basics", label: "Basics tab", does: "Name, kind and address of the webhook." },
    { id: "tab:request", label: "Request tab", does: "Headers and message body." },
    { id: "tab:security", label: "Security tab", does: "The signing secret." },
    { id: "tab:test", label: "Test tab", does: "Sends a sample request (a saved webhook only)." },
    { id: "tab:log", label: "Log tab", does: "Shows recent deliveries and failures (a saved webhook only)." },
  ],
  tasks: [
    {
      id: "add", label: "Add a webhook",
      steps: [
        { control: "webhooks.new", text: "Press New webhook; a panel opens on the right." },
        { control: "tab:basics", text: "Give it a name, pick what fires it, and choose what it sends." },
        { control: "tab:request", text: "Set headers and the body if the receiver needs a particular shape." },
        { control: "webhooks.save", text: "Press Create to save it. The Test and Log tabs appear once it is saved." },
        { control: "tab:test", text: "Send a test and read the answer before relying on it." },
      ],
    },
    {
      id: "failing", label: "Find out why a webhook is failing",
      steps: [
        { control: "webhooks.row", text: "Click the webhook in the list to open its panel." },
        { control: "tab:log", text: "Open the Log tab and read the last error; resume the webhook if it paused." },
      ],
    },
    {
      id: "sign", label: "Check the signature on the receiver",
      steps: [
        { control: "webhooks.row", text: "Click the webhook in the list to open its panel." },
        { control: "tab:security", text: "Open the Security tab for the signing secret and how requests are signed." },
      ],
    },
    {
      id: "edit", label: "Change an existing webhook",
      steps: [
        { control: "webhooks.row", text: "Click the webhook in the list to open its panel." },
        { control: "tab:basics", text: "Change the name, kind details or address." },
        { control: "webhooks.save", text: "Press Save; it is greyed until something has changed." },
      ],
    },
  ],
};
