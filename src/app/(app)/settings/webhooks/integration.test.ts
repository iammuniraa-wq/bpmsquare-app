import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { SETTINGS_MENU, visibleSettingsMenu } from "@/lib/settingsMenu";
import { normalizeDocument, type DocumentView } from "../middleware/api";
import { WEBHOOK_TARGET, draftFromDocument, draftPatch, draftProblem, isDraftDirty } from "../middleware/documentsLogic";
import { MiddlewareProvider, type MiddlewareCtx } from "../middleware/context";
import { LinkPanel } from "../middleware/LinksTab";
import { recordButtonWebhookId, sendToWebhookAction } from "../../accounts/[id]/sendAction";

const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e);

// ── Settings menu ───────────────────────────────────────────────────────────

const ids = (features: object | undefined) =>
  visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features: features as Parameters<typeof visibleSettingsMenu>[0]["features"] }).flatMap((g) => g.items.map((i) => i.id));

describe("the Settings menu with the Webhooks library", () => {
  it("shows Webhooks and hides Webhooks & push only when the flag is on", () => {
    expect(ids({ webhooks_library: true })).toContain("webhooks");
    expect(ids({ webhooks_library: true })).not.toContain("push");
  });
  it("shows an unflagged workspace today's page and nothing new", () => {
    for (const f of [undefined, {}, { webhooks_library: false }]) {
      expect(ids(f)).toContain("push");
      expect(ids(f)).not.toContain("webhooks");
    }
  });
  it("keeps the new entry admin only, in Integrations", () => {
    const e = SETTINGS_MENU.find((m) => m.id === "webhooks")!;
    expect(e.group).toBe("integrations");
    expect(e.adminOnly).toBe(true);
    expect(e.href).toBe("/settings/webhooks");
    expect(visibleSettingsMenu({ isAdmin: false, canEdit: () => true, features: { webhooks_library: true } as never }).flatMap((g) => g.items.map((i) => i.id))).not.toContain("webhooks");
  });
});

// ── Links: the Webhook target ───────────────────────────────────────────────

const quoteDoc = (over: Partial<DocumentView> = {}): DocumentView => normalizeDocument({
  key: "quote", label: "Quote", source: "standard_quote", enabled: true, summary: "Awarded", target: { key: "quote", label: "Quote" },
  targets: [{ key: "quote", label: "Quote", available: true, hint: null }, { key: "webhook", label: "Webhook", available: true, hint: null }],
  include: [], ...over,
}, null, [{ id: "w9", name: "ERP push" }]);

describe("the Links target Webhook", () => {
  it("reads the webhook choices and the stored webhook, from the document or the list", () => {
    const d = quoteDoc({ webhook_id: "w9" } as never);
    expect(d.webhookId).toBe("w9");
    expect(d.webhooks).toEqual([{ id: "w9", name: "ERP push" }]);
    expect(normalizeDocument({ key: "quote", webhooks: [{ id: "x", name: "X" }, { nope: 1 }] } as never).webhooks).toEqual([{ id: "x", name: "X" }]);
    expect(normalizeDocument({ key: "quote" }).webhookId).toBeNull();
  });
  it("sends no webhook until the target is Webhook, and then the webhook with it", () => {
    const d = quoteDoc();
    const base = draftFromDocument(d);
    expect(isDraftDirty(d, base)).toBe(false);
    expect(draftPatch(d, { ...base, webhookId: "w9" })).toEqual({});
    expect(draftPatch(d, { ...base, target: WEBHOOK_TARGET, webhookId: "w9" })).toEqual({ target: "webhook", webhookId: "w9" });
  });
  it("refuses a Webhook target with no webhook chosen, in a sentence", () => {
    const d = quoteDoc();
    expect(draftProblem(d, { ...draftFromDocument(d), target: WEBHOOK_TARGET })).toBe("Choose which webhook to send to.");
    expect(draftProblem(d, { ...draftFromDocument(d), target: WEBHOOK_TARGET, webhookId: "w9" })).toBeNull();
  });
  it("shows the second dropdown only for that target", () => {
    const ctx = { connection: null, health: { data: null }, sync: { data: null } } as unknown as MiddlewareCtx;
    const panel = (doc: DocumentView) => html(el(MiddlewareProvider, { value: ctx }, el(LinkPanel, { doc, connected: true, onClose: () => undefined, onSaved: () => undefined })));
    expect(panel(quoteDoc())).not.toContain("Which webhook");
    const out = panel(quoteDoc({ target: { key: "webhook", label: "Webhook" }, webhook_id: "w9" } as never));
    expect(out).toContain("Which webhook");
    expect(out).toContain("ERP push");
  });
});

// ── The account's Send entry ────────────────────────────────────────────────

describe("the account page's Send to <webhook> entry", () => {
  it("reads the chosen webhook from the config, and nothing from a config without it", () => {
    expect(recordButtonWebhookId({ webhooks_library: { record_buttons: { accounts: "w1" } } })).toBe("w1");
    for (const c of [null, undefined, {}, { webhooks_library: {} }, { webhooks_library: { record_buttons: { accounts: null } } }]) expect(recordButtonWebhookId(c)).toBeNull();
  });
  it("posts to the account's push route and names the webhook", () => {
    expect(sendToWebhookAction("acc 1", "ERP push")).toMatchObject({
      label: "Send to ERP push", endpoint: "/api/accounts/acc%201/push", method: "POST", successText: "Sent to ERP push",
    });
  });
});
