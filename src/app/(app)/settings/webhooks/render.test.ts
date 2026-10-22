import { describe, expect, it, vi } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { TestResult, TokenChoice } from "./api";
import { draftFromWebhook, emptyDraft, type Draft } from "./logic";
import { eventHook, hook } from "./fixtures";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/settings/webhooks",
}));

import SidePanel from "@/components/ui/SidePanel";
import WebhooksClient, { WebhookRows } from "./WebhooksClient";
import WebhookPanel, { BasicsTab } from "./WebhookPanel";
import RequestTab, { HeadersEditor, TemplateEditor } from "./RequestTab";
import SecurityTab from "./SecurityTab";
import TestTab, { RequestBlock, ResultBlock } from "./TestTab";
import LogTab, { LogList } from "./LogTab";
import TokenPicker from "./TokenPicker";

// createElement's overloads reject a component whose required props come loose; these are closed-state markup checks.
const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e);
const noop = () => undefined;
const NOW = new Date("2026-10-21T18:00:00");

const tokens: TokenChoice[] = [
  { token: "account.name", label: "Account name", pii: false, kind: "text" },
  { token: "account.email", label: "Account email", pii: true, kind: "text" },
  { token: "event", label: "Event", pii: false, kind: "text" },
];
const draftOf = (over: Partial<Draft> = {}): Draft => ({ ...draftFromWebhook(hook(), null), ...over });

describe("the list", () => {
  const rows = (items = [hook(), eventHook(), hook({ id: "old", name: "Legacy endpoint", url: "http://old.example.com/in", needs_attention: "The address must use https", used_by: [] }),
    eventHook({ id: "p", name: "Old BI feed", paused_reason: "failures", failure_count: 15, active: false, last_delivery_at: null, last_status: null })]) =>
    html(el(WebhookRows, { items, onOpen: noop, onResume: noop, now: NOW }));

  it("shows the kind, name, host, state, last call and Used-by chip", () => {
    const out = rows();
    expect(out).toContain("Call");
    expect(out).toContain("Event");
    expect(out).toContain("ERP push");
    expect(out).toContain("POST erp.acme.com");
    expect(out).toContain("Today 14:02 OK");
    expect(out).toContain("2 uses");
  });
  it("says a migrated http address needs attention in plain words, and offers Resume only for a paused one", () => {
    const out = rows();
    expect(out).toContain("Needs attention");
    expect(out).toContain("The address must use https");
    expect(out).toContain("Paused after 15 failures");
    expect(out).toContain("Never called");
    expect((out.match(/>Resume</g) ?? []).length).toBe(1);
  });
  it("lets the whole name open the panel with a labelled button", () => {
    expect(rows()).toContain('aria-label="ERP push: open"');
  });
  it("shows a loading line before the first answer, not an empty state", () => {
    const out = html(el(WebhooksClient, null));
    expect(out).toContain("Loading");
    expect(out).not.toContain("No webhooks yet");
  });
});

describe("the side panel", () => {
  it("is a dialog with a title, a Close button and the footer's action", () => {
    const out = html(el(SidePanel, { title: "ERP push", subtitle: "Call", onClose: noop, footer: create("button", null, "Save") }, create("p", null, "body")));
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain("ERP push");
    expect(out).toContain(">Close<");
    expect(out).toContain(">Save<");
  });
  it("opens a saved webhook on Basics with all five tabs, and a new one with two", () => {
    const saved = html(el(WebhookPanel, { webhook: hook(), startKind: "call", callObjects: [], recordButtonId: null, onClose: noop, onChanged: noop, onDeleted: noop }));
    for (const t of ["Basics", "Request", "Security", "Test", "Log"]) expect(saved).toContain(`>${t}`);
    expect(saved).toContain("Call · POST erp.acme.com");
    expect(saved).toContain(">Save<");
    const fresh = html(el(WebhookPanel, { webhook: null, startKind: "call", callObjects: [], recordButtonId: null, onClose: noop, onChanged: noop, onDeleted: noop }));
    expect(fresh).toContain("New webhook");
    expect(fresh).toContain(">Create<");
    expect(fresh).not.toContain(">Security");
  });
  it("warns above the tabs when the webhook paused itself, with Resume", () => {
    const out = html(el(WebhookPanel, { webhook: hook({ paused_reason: "failures", failure_count: 15, last_error: "HTTP 500" }), startKind: "call", callObjects: [], recordButtonId: null, onClose: noop, onChanged: noop, onDeleted: noop }));
    expect(out).toContain("Paused after 15 failures.");
    expect(out).toContain("HTTP 500");
    expect(out).toContain(">Resume<");
  });
});

describe("Basics", () => {
  const basics = (draft: Draft, current = hook()) =>
    html(el(BasicsTab, { draft, onChange: noop, errors: {}, current, objects: [{ key: "accounts", label: "Accounts" }, { key: "standard_quotes", label: "Standard Quotes" }], onDelete: noop, blocked: null }));

  it("locks the kind on a saved webhook and offers the Accounts button for a Call on accounts", () => {
    const out = basics(draftOf());
    expect(out).toContain("Button on Accounts");
    expect(out).not.toContain('role="radiogroup"');
    expect(out).toContain("Used by");
    expect(out).toContain("Links: Quote");
    expect(out).toContain("Delete webhook");
  });
  it("lets a new webhook choose its kind, and an Event pick its objects", () => {
    const out = basics(emptyDraft("event"), null as never);
    expect(out).toContain("Changes sent");
    expect(out).toContain("All objects");
    expect(out).not.toContain("Delete webhook");
    expect(basics(emptyDraft("call"), null as never)).toContain("Sends");
  });
  it("shows the refusal beside the field", () => {
    const out = html(el(BasicsTab, { draft: draftOf({ name: "" }), onChange: noop, errors: { name: "Give the webhook a name." }, current: hook(), objects: [], onDelete: noop, blocked: "It is still used by Links: Quote. Remove it there first." }));
    expect(out).toContain("Give the webhook a name.");
    expect(out).toContain("It is still used by Links: Quote.");
  });
});

describe("Request", () => {
  const req = (draft: Draft, over: object = {}) =>
    html(el(RequestTab, { draft, onChange: noop, errors: {}, attention: null, tokens, tokensLoading: false, tokensError: null, ...over }));

  it("shows the address, method, headers and the standard or template payload for a Call", () => {
    const out = req(draftOf());
    expect(out).toContain("Address");
    expect(out).toContain("Method");
    expect(out).toContain("Headers");
    expect(out).toContain("Payload");
    expect(out).toContain("Send personal data");
    expect(out).not.toContain("Insert a token");
    expect(req(draftOf({ payloadMode: "template", template: "{}" }))).toContain("Insert a token");
  });
  it("shows only the address for an Event, as a signed change feed", () => {
    const out = req(draftFromWebhook(eventHook(), null));
    expect(out).toContain("Change feed, signed.");
    expect(out).not.toContain("Method");
    expect(out).not.toContain("Payload");
  });
  it("offers Body from mapping only on a saved Standard Quote webhook, and shows where the body comes from", () => {
    const saved = { id: "w1", name: "ERP push" };
    expect(req(draftOf({ objectType: "standard_quotes" }), { webhook: saved })).toContain("Body from mapping");
    expect(req(draftOf({ objectType: "standard_quotes" }), { webhook: null })).not.toContain("Body from mapping");
    expect(req(draftOf(), { webhook: saved })).not.toContain("Body from mapping");
    const out = req(draftOf({ objectType: "standard_quotes", payloadMode: "mapping" }), { webhook: saved });
    expect(out).toContain("Body from Mapping: Quote → ERP push");
    expect(out).toContain("Open mapping");
    expect(out).toContain("connection=webhook%3Aw1");
    expect(out).toContain("Read the id from the answer");
  });
  it("sends no body for GET", () => {
    expect(req(draftOf({ method: "GET" }))).not.toContain("Payload");
  });
  it("puts the plain https status above a migrated http address", () => {
    expect(req(draftOf({ url: "http://old.example.com" }), { attention: "The address must use https" })).toContain("The address must use https");
  });
  it("never prints a stored header value: it reads Set with Replace", () => {
    const out = html(el(HeadersEditor, { headers: draftOf().headers, onChange: noop }));
    expect(out).toContain("X-Api-Key");
    expect(out).toContain(">Set<");
    expect(out).toContain(">Replace<");
    expect(out).not.toContain('type="password"');
  });
  it("masks a header value that is being typed, and caps the list at ten", () => {
    const typing = [{ name: "X-New", value: "", stored: false, replacing: false }];
    expect(html(el(HeadersEditor, { headers: typing, onChange: noop }))).toContain('type="password"');
    const ten = Array.from({ length: 10 }, (_, i) => ({ name: `H${i}`, value: "v", stored: false, replacing: false }));
    expect(html(el(HeadersEditor, { headers: ten, onChange: noop }))).toMatch(/<button[^>]*disabled[^>]*>Add a header</);
  });
  it("shows the template with the token picker closed until asked", () => {
    const out = html(el(TemplateEditor, { value: '{"a":"{{event}}"}', onChange: noop, tokens, tokensLoading: false, tokensError: null }));
    expect(out).toContain("Body");
    expect(out).toContain("Insert a token");
    expect(out).not.toContain("Always available");
  });
});

describe("the token picker", () => {
  it("groups tokens, tags personal ones and keeps system tokens last", () => {
    const out = html(el(TokenPicker, { tokens, loading: false, onPick: noop, startOpen: true }));
    expect(out).toContain("Account");
    expect(out).toContain("Always available");
    expect(out).toContain("personal");
    expect(out.indexOf("Account name")).toBeLessThan(out.indexOf("Always available"));
    expect(out).toContain("{{account.name}}");
  });
  it("says so while loading, and when the load failed", () => {
    expect(html(el(TokenPicker, { tokens: [], loading: true, onPick: noop, startOpen: true }))).toContain("Loading");
    expect(html(el(TokenPicker, { tokens: [], loading: false, error: "Could not load tokens.", onPick: noop, startOpen: true }))).toContain("Could not load tokens.");
  });
});

describe("Security", () => {
  it("reads Set with Regenerate, and lists the headers every call carries", () => {
    const out = html(el(SecurityTab, { webhook: hook(), revealed: null, onRevealed: noop, onChanged: noop }));
    expect(out).toContain(">Set<");
    expect(out).toContain(">Regenerate<");
    expect(out).toContain("X-BPMSquare-Signature");
    expect(out).toContain("X-BPMSquare-Idempotency-Key");
  });
  it("shows a fresh secret once with Copy and the warning, never otherwise", () => {
    const shown = html(el(SecurityTab, { webhook: hook(), revealed: "whsec_abc123", onRevealed: noop, onChanged: noop }));
    expect(shown).toContain("whsec_abc123");
    expect(shown).toContain(">Copy<");
    expect(shown).toContain("It is not shown again.");
    expect(html(el(SecurityTab, { webhook: hook(), revealed: null, onRevealed: noop, onChanged: noop }))).not.toContain("whsec_");
  });
});

describe("Test", () => {
  it("asks for a sample record for a Call and pings an Event without one", () => {
    const call = html(el(TestTab, { webhook: hook(), blocked: false, monitorLink: true }));
    expect(call).toContain("Sample record");
    expect(call).toContain(">Preview<");
    expect(call).toContain(">Send test<");
    const ev = html(el(TestTab, { webhook: eventHook(), blocked: false, monitorLink: true }));
    expect(ev).not.toContain("Sample record");
    expect(ev).toContain(">Send a test ping<");
  });
  it("asks to save first when the panel has unsaved changes", () => {
    expect(html(el(TestTab, { webhook: hook(), blocked: true, monitorLink: false }))).toContain("Save your changes first.");
  });
  it("shows the request, and the answer with a link to the Monitor only when the Monitor exists", () => {
    const req = html(el(RequestBlock, { request: { method: "POST", url: "https://erp.acme.com/h", headers: ["X-BPMSquare-Event"], body: '{"a":1}' }, title: "Request" }));
    expect(req.replace(/<!-- -->/g, "")).toContain("POST https://erp.acme.com/h");
    expect(req).toContain("X-BPMSquare-Event");
    const result: TestResult = {
      ok: false, status: 502, durationMs: 1500, request: null, response: { status: 502, body: "Bad gateway" }, messageId: "m1",
      headline: "The receiver did not answer.", fix: "Check the address.",
    };
    const withMonitor = html(el(ResultBlock, { result, monitorLink: true }));
    expect(withMonitor).toContain("The receiver did not answer.");
    expect(withMonitor).toContain("Check the address.");
    expect(withMonitor).toContain("Bad gateway");
    expect(withMonitor).toContain("1.5 s");
    expect(withMonitor).toContain("Open in Monitor");
    expect(html(el(ResultBlock, { result, monitorLink: false }))).not.toContain("Open in Monitor");
  });
  it("has a body-less request say so", () => {
    expect(html(el(RequestBlock, { request: { method: "GET", url: "https://a.example", headers: [], body: null }, title: "Request" }))).toContain("No body is sent.");
  });
});

describe("the Delivery log", () => {
  it("lists time, status, duration and headline, newest first as given", () => {
    const out = html(el(LogList, {
      now: NOW,
      items: [
        { id: "1", at: "2026-10-21T14:02:00", status: "ok", http_status: 200, duration_ms: 120, headline: "Sent", monitorId: null },
        { id: "2", at: "2026-10-20T09:10:00", status: "failed", http_status: 500, duration_ms: 2400, headline: "Receiver error", monitorId: null },
      ],
    }));
    const text = out.replace(/<!-- -->/g, "");
    expect(text).toContain("Today 14:02");
    expect(text).toContain("200 · 120 ms");
    expect(text).toContain("Yesterday 09:10");
    expect(text).toContain("500 · 2.4 s");
    expect(out).toContain("Receiver error");
  });
  it("has an empty line that points at the Test tab", () => {
    expect(html(el(LogList, { items: [] }))).toContain("Send a test from the Test tab.");
  });
  it("links the Monitor only when it exists", () => {
    expect(html(el(LogTab, { webhookId: "w1", monitorLink: true }))).toContain("Open in Monitor");
    expect(html(el(LogTab, { webhookId: "w1", monitorLink: false }))).not.toContain("Open in Monitor");
  });
});
