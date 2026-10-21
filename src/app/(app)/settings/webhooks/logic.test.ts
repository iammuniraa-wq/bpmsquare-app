import { describe, expect, it } from "vitest";
import type { TokenChoice } from "./api";
import {
  MAX_FAILURES, WEBHOOKS_FLAG, bareToken, buildInput, canResume, deleteBlockedWord, deliveryLine, draftFromWebhook, draftProblems, emptyDraft,
  groupTokens, hostOf, insertToken, isDraftDirty, isHttps, lastCallWord, statusWord, tabForField, targetWord, tokensIn, usedByChip, usedByLine,
  webhookState, webhooksLibraryOn, whenWord,
} from "./logic";
import { eventHook, hook } from "./fixtures";

const NOW = new Date("2026-10-21T18:00:00");
const toks: TokenChoice[] = [
  { token: "account.name", label: "Account name", pii: false, kind: "text" },
  { token: "{{account.email}}", label: "Account email", pii: true, kind: "text" },
  { token: "record.id", label: "Record id", pii: false, kind: "text" },
  { token: "event", label: "Event", pii: false, kind: "text" },
];

describe("the flag", () => {
  it("is on only for an explicit true", () => {
    expect(WEBHOOKS_FLAG).toBe("webhooks_library");
    expect(webhooksLibraryOn({ webhooks_library: true })).toBe(true);
    for (const f of [undefined, null, {}, { webhooks_library: false }, { webhooks_library: "true" }, "x"]) expect(webhooksLibraryOn(f)).toBe(false);
  });
});

describe("a row", () => {
  it("reads needs attention before paused before off before on", () => {
    expect(webhookState(hook()).word).toBe("On");
    expect(webhookState(hook({ active: false })).key).toBe("off");
    expect(webhookState(hook({ paused_reason: "failures", failure_count: MAX_FAILURES, active: false })).word).toBe("Paused after 15 failures");
    expect(webhookState(hook({ paused_reason: "by hand", failure_count: 2 })).word).toBe("Paused");
    expect(webhookState(hook({ paused_reason: "x", needs_attention: "The address must use https" })).key).toBe("attention");
  });
  it("offers Resume only while paused", () => {
    expect(canResume(hook())).toBe(false);
    expect(canResume(hook({ paused_reason: "failures" }))).toBe(true);
  });
  it("shows the method and host, an Event always POST", () => {
    expect(targetWord(hook())).toBe("POST erp.acme.com");
    expect(targetWord(hook({ method: "GET" }))).toBe("GET erp.acme.com");
    expect(targetWord(eventHook({ method: "PUT" }))).toBe("POST hooks.dw.io");
    expect(hostOf("http://old.example.com:8080/x?y=1")).toBe("old.example.com:8080");
    expect(hostOf("not a url/with path")).toBe("not a url");
  });
  it("words the last call in the viewer's day", () => {
    expect(whenWord("2026-10-21T14:02:00", NOW)).toBe("Today 14:02");
    expect(whenWord("2026-10-20T09:10:00", NOW)).toBe("Yesterday 09:10");
    expect(whenWord("2026-10-12T09:05:00", NOW)).toBe("12 Oct 09:05");
    expect(whenWord(null, NOW)).toBe("");
    expect(whenWord("garbage", NOW)).toBe("");
  });
  it("words the status as OK, Failed or Not sent", () => {
    expect(statusWord("200")).toBe("OK");
    expect(statusWord("sent")).toBe("OK");
    expect(statusWord("500")).toBe("Failed");
    expect(statusWord("redirected")).toBe("Not sent");
    expect(statusWord(null, "boom")).toBe("Failed");
    expect(statusWord(null)).toBe("");
  });
  it("says Never called until there is a call", () => {
    expect(lastCallWord(hook({ last_delivery_at: null, last_status: null }), NOW)).toBe("Never called");
    expect(lastCallWord(hook(), NOW)).toBe("Today 14:02 OK");
  });
  it("counts uses and names them when a delete is refused", () => {
    expect(usedByChip([])).toBeNull();
    expect(usedByChip(hook().used_by)).toBe("2 uses");
    expect(usedByChip([{ kind: "button", label: "Accounts" }])).toBe("1 use");
    expect(usedByLine({ kind: "link", label: "Quote" })).toBe("Links: Quote");
    expect(deleteBlockedWord(hook().used_by)).toBe("It is still used by Links: Quote, Coverage: EU team. Remove it there first.");
  });
  it("words a delivery line", () => {
    const l = deliveryLine({ id: "d", at: "2026-10-21T14:02:00", status: "ok", http_status: 200, duration_ms: 1250, headline: "Sent", monitorId: null }, NOW);
    expect(l).toMatchObject({ when: "Today 14:02", status: "200", ok: true, duration: "1.3 s", headline: "Sent" });
    expect(deliveryLine({ id: "d", at: null, status: "failed", http_status: 502, duration_ms: 90, headline: null, monitorId: null }, NOW)).toMatchObject({ ok: false, duration: "90 ms", headline: "" });
  });
});

describe("the draft", () => {
  it("is clean until something changes and sends only the change", () => {
    const w = hook();
    const d = draftFromWebhook(w, null);
    expect(isDraftDirty(d, w, null)).toBe(false);
    expect(buildInput({ ...d, name: "ERP push 2" }, w)).toEqual({ name: "ERP push 2" });
    expect(buildInput({ ...d, timeoutSec: 20, method: "PUT" }, w)).toEqual({ timeout_ms: 20000, method: "PUT" });
  });
  it("never reads a stored header value back, and only sends one that was replaced", () => {
    const w = hook();
    const d = draftFromWebhook(w, null);
    expect(d.headers).toEqual([{ name: "X-Api-Key", value: "", stored: true, replacing: false }]);
    expect(isDraftDirty(d, w, null)).toBe(false);
    const replaced = { ...d, headers: [{ ...d.headers[0], replacing: true, value: "k-2" }] };
    expect(buildInput(replaced, w)).toEqual({ headers: [{ name: "X-Api-Key", value: "k-2" }] });
    expect(buildInput({ ...d, headers: [] }, w)).toEqual({ headers: [] });
    expect(buildInput({ ...d, headers: [...d.headers, { name: "X-New", value: "v", stored: false, replacing: false }] }, w).headers)
      .toEqual([{ name: "X-Api-Key", value: "" }, { name: "X-New", value: "v" }]);
  });
  it("sends a new Call with everything and a new Event with its objects", () => {
    const call = { ...emptyDraft("call", "accounts"), name: " ERP ", url: "https://a.example/h", buttonOnAccounts: true, payloadMode: "template" as const, template: "{}" };
    expect(buildInput(call, null)).toMatchObject({ kind: "call", name: "ERP", object_type: "accounts", payload_mode: "template", template: "{}", button_on: "accounts", timeout_ms: 15000 });
    const ev = { ...emptyDraft("event"), name: "DW", url: "https://a.example/h" };
    const out = buildInput(ev, null);
    expect(out).toMatchObject({ kind: "event", object_types: ["*"] });
    expect(out.object_type).toBeUndefined();
  });
  it("tracks the Accounts button against the stored choice", () => {
    const w = hook();
    const d = draftFromWebhook(w, "w1");
    expect(d.buttonOnAccounts).toBe(true);
    expect(buildInput({ ...d, buttonOnAccounts: false }, w, "w1")).toEqual({ button_on: null });
    expect(buildInput({ ...d }, w, "w1")).toEqual({});
  });
});

describe("the checks before asking the server", () => {
  const ok = { ...emptyDraft("call"), name: "ERP", url: "https://erp.acme.com/x" };
  it("passes a complete draft", () => expect(draftProblems(ok)).toEqual([]));
  it("asks for a name and an address, and refuses http", () => {
    expect(draftProblems({ ...ok, name: " ", url: "" }).map((p) => p.field)).toEqual(["name", "url"]);
    expect(draftProblems({ ...ok, url: "http://erp.acme.com" })[0]).toEqual({ field: "url", message: "The address must use https." });
    expect(isHttps("https://x.example")).toBe(true);
    expect(isHttps("ftp://x")).toBe(false);
  });
  it("keeps personal data out of the address", () => {
    expect(draftProblems({ ...ok, url: "https://a.example/{{account.email}}" }, toks)[0].message).toBe("Personal data cannot go in the address.");
    expect(draftProblems({ ...ok, url: "https://a.example/{{account.name}}" }, toks)).toEqual([]);
  });
  it("holds headers to the contract", () => {
    const h = (name: string, value = "v") => ({ name, value, stored: false, replacing: false });
    expect(draftProblems({ ...ok, headers: [h("Host")] })[0].message).toMatch(/set by BPMSquare/);
    expect(draftProblems({ ...ok, headers: [h("X-BPMSquare-Event")] })[0].message).toMatch(/set by BPMSquare/);
    expect(draftProblems({ ...ok, headers: [h("bad name")] })[0].message).toMatch(/not a valid header name/);
    expect(draftProblems({ ...ok, headers: [h("A"), h("a")] })[0].message).toMatch(/listed twice/);
    expect(draftProblems({ ...ok, headers: [h("A", "")] })[0].message).toMatch(/Give "A" a value/);
    expect(draftProblems({ ...ok, headers: [{ name: "A", value: "", stored: true, replacing: false }] })).toEqual([]);
    expect(draftProblems({ ...ok, headers: Array.from({ length: 11 }, (_, i) => h(`H${i}`)) })[0].message).toBe("Use at most 10 headers.");
  });
  it("checks a template: JSON, size, known tokens, personal data", () => {
    const t = (template: string, allowPii = false) => ({ ...ok, payloadMode: "template" as const, template, allowPii });
    expect(draftProblems(t(""))[0].field).toBe("template");
    expect(draftProblems(t("{nope"))[0].message).toMatch(/valid JSON/);
    expect(draftProblems(t("x".repeat(17 * 1024)))[0].message).toMatch(/16 KB/);
    expect(draftProblems(t('{"a":"{{account.name}}"}'), toks)).toEqual([]);
    expect(draftProblems(t('{"a":"{{account.nope}}"}'), toks)[0].message).toBe("{{account.nope}} is not a token you can use here.");
    expect(draftProblems(t('{"a":"{{account.email}}"}'), toks)[0].message).toMatch(/Send personal data/);
    expect(draftProblems(t('{"a":"{{account.email}}"}', true), toks)).toEqual([]);
    // Without the token list loaded the server decides; the page does not guess.
    expect(draftProblems(t('{"a":"{{anything}}"}'))).toEqual([]);
  });
  it("holds the wait to 5 to 30 seconds and an Event to at least one object", () => {
    expect(draftProblems({ ...ok, timeoutSec: 3 })[0].field).toBe("timeout_ms");
    expect(draftProblems({ ...emptyDraft("event"), name: "DW", url: "https://a.example", objectTypes: [] })[0].field).toBe("object_types");
  });
  it("sends a refusal to the tab where it can be fixed", () => {
    expect(tabForField("name")).toBe("basics");
    expect(tabForField("object_type")).toBe("basics");
    expect(tabForField("url")).toBe("request");
    expect(tabForField("headers")).toBe("request");
  });
});

describe("tokens", () => {
  it("finds and bares them", () => {
    expect(tokensIn('{"a":"{{ account.name }} {{event}}"}')).toEqual(["account.name", "event"]);
    expect(bareToken("{{ account.name }}")).toBe("account.name");
  });
  it("groups by owner with the always-available ones last", () => {
    const g = groupTokens(toks);
    expect(g.map((x) => x.id)).toEqual(["account", "system"]);
    expect(g[1].label).toBe("Always available");
    expect(groupTokens(toks, "email").flatMap((x) => x.tokens.map((t) => t.label))).toEqual(["Account email"]);
    expect(groupTokens(toks, "zzz")).toEqual([]);
  });
  it("inserts at the caret, replacing a selection", () => {
    expect(insertToken('{"a":""}', "account.name", 6, 6)).toEqual({ text: '{"a":"{{account.name}}"}', caret: 22 });
    expect(insertToken("abcdef", "{{x}}", 1, 4)).toEqual({ text: "a{{x}}ef", caret: 6 });
    expect(insertToken("ab", "x", 99, 99).text).toBe("ab{{x}}");
  });
});
