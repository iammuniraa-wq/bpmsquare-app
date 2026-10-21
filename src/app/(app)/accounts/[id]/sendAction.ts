import type { RecordAction } from "@/components/page/recordActions";

// "Send to <webhook>" in the account page's overflow menu. It replaces the unmounted AccountPushButton when the
// Webhooks library is on: the same push route, now routed through the library (Coverage first, then the webhook
// picked as the Accounts button in Settings > Webhooks).

/** The id of the webhook chosen as the Accounts button, or null. Read by name so a missing key is simply "none". */
export function recordButtonWebhookId(config: unknown): string | null {
  const id = (config as { webhooks_library?: { record_buttons?: { accounts?: unknown } } } | null | undefined)?.webhooks_library?.record_buttons?.accounts;
  return typeof id === "string" && id ? id : null;
}

/** The menu entry, described as data so the server page can hand it across the client boundary. */
export function sendToWebhookAction(accountId: string, webhookName: string): RecordAction {
  return {
    label: `Send to ${webhookName}`,
    endpoint: `/api/accounts/${encodeURIComponent(accountId)}/push`,
    method: "POST",
    successText: `Sent to ${webhookName}`,
    errorText: "Could not send this account. Check the webhook in Settings > Webhooks.",
  };
}
