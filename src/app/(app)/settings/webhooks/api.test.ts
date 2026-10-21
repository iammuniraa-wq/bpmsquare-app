import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FieldProblem, InUseProblem, callWebhooksFor, createWebhook, deleteWebhook, listDeliveries, listTokens, listWebhooks, normalizeList, normalizeWebhook,
  testWebhook, updateWebhook,
} from "./api";
import { ApiProblem } from "../middleware/api";
import { eventHook, hook } from "./fixtures";

const reply = (status: number, body: unknown) =>
  vi.fn(async (..._args: unknown[]) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const use = (f: ReturnType<typeof reply>) => vi.stubGlobal("fetch", f);
afterEach(() => vi.unstubAllGlobals());

describe("normalising what the server sends", () => {
  it("gives every optional part a safe default", () => {
    const w = normalizeWebhook({ id: "a", name: "X" });
    expect(w).toMatchObject({
      kind: "call", method: "POST", payload_mode: "standard", timeout_ms: 15000, active: true, secret: "set", headers: [], used_by: [],
      paused_reason: null, needs_attention: null, failure_count: 0,
    });
  });
  it("keeps header names and drops header values, whatever the server sent", () => {
    const w = normalizeWebhook({ id: "a", headers: [{ name: "X-Key", value: "oops", set: true }, { nope: 1 }] } as never);
    expect(w.headers).toEqual([{ name: "X-Key", set: true }]);
    expect(JSON.stringify(w)).not.toContain("oops");
  });
  it("reads the list, the record button and a pending database", () => {
    const l = normalizeList({ webhooks: [hook()], recordButtons: { accounts: "w1" }, objects: [{ key: "accounts", label: "Accounts" }], needsDatabaseUpdate: true, bundle: "run-bundle-11.sql" });
    expect(l).toMatchObject({ recordButtons: { accounts: "w1" }, needsDatabaseUpdate: true, bundle: "run-bundle-11.sql" });
    expect(l.webhooks).toHaveLength(1);
    expect(normalizeList({})).toMatchObject({ webhooks: [], needsDatabaseUpdate: false, recordButtons: { accounts: null } });
  });
  it("offers Links only the active, healthy Call webhooks of one object", () => {
    const list = [hook(), hook({ id: "off", active: false }), hook({ id: "bad", needs_attention: "The address must use https" }), eventHook(), hook({ id: "q", object_type: "standard_quotes" })];
    expect(callWebhooksFor(list, "accounts").map((w) => w.id)).toEqual(["w1"]);
    expect(callWebhooksFor(list, "standard_quotes").map((w) => w.id)).toEqual(["q"]);
  });
});

describe("the calls", () => {
  it("lists from the library route", async () => {
    const f = reply(200, { webhooks: [hook()] });
    use(f);
    expect((await listWebhooks()).webhooks).toHaveLength(1);
    expect(f.mock.calls[0][0]).toBe("/api/settings/webhooks-library");
  });
  it("shows the signing secret once, from the create response only", async () => {
    use(reply(201, { webhook: { ...hook(), secret: "whsec_abc" } }));
    const r = await createWebhook({ kind: "call", name: "A", url: "https://a.example" });
    expect(r.revealedSecret).toBe("whsec_abc");
    expect(r.webhook.secret).toBe("set");
    use(reply(200, { webhook: hook() }));
    expect((await updateWebhook("w1", { name: "B" })).revealedSecret).toBeNull();
  });
  it("sends a header value only in what the person typed", async () => {
    const f = reply(200, { webhook: hook() });
    use(f);
    await updateWebhook("w1", { headers: [{ name: "X-Key", value: "" }] });
    expect(f.mock.calls[0][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ headers: [{ name: "X-Key", value: "" }] }) });
  });
  it("turns a 422 into the server's own sentences, tied to fields", async () => {
    use(reply(422, { errors: [{ field: "url", message: "The address must use https." }, { field: "name", message: "Name taken." }] }));
    const e = await createWebhook({ kind: "call" }).catch((x) => x);
    expect(e).toBeInstanceOf(FieldProblem);
    expect((e as FieldProblem).errors.map((x) => x.field)).toEqual(["url", "name"]);
    expect((e as FieldProblem).message).toBe("The address must use https.");
  });
  it("turns a 409 on delete into what still uses it", async () => {
    use(reply(409, { error: "In use.", used_by: [{ kind: "link", label: "Quote" }, { kind: "x", label: "ignored" }] }));
    const e = await deleteWebhook("w1").catch((x) => x);
    expect(e).toBeInstanceOf(InUseProblem);
    expect((e as InUseProblem).usedBy).toEqual([{ kind: "link", label: "Quote" }]);
  });
  it("says a route that is not installed yet is being installed", async () => {
    use(reply(404, "<html>nope</html>"));
    const e = await listWebhooks().catch((x) => x);
    expect(e).toBeInstanceOf(ApiProblem);
    expect((e as ApiProblem).installing).toBe(true);
  });
  it("reads tokens, a test result and the delivery log", async () => {
    use(reply(200, { tokens: [{ token: "account.name", label: "Name", pii: false, kind: "weird" }] }));
    expect(await listTokens("accounts")).toEqual([{ token: "account.name", label: "Name", pii: false, kind: "text" }]);
    use(reply(200, { ok: true, status: 200, durationMs: 120, request: { method: "POST", url: "https://a.example", headers: ["X-BPMSquare-Event"], body: { a: 1 } }, response: { status: 200, body: { ok: true } }, messageId: "m1", headline: "Sent", fix: null }));
    const t = await testWebhook("w1", "acc1");
    expect(t.request?.body).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(t.response?.body).toBe(JSON.stringify({ ok: true }, null, 2));
    use(reply(200, { items: [{ id: "d1", at: "2026-10-21T10:00:00Z", status: "ok", http_status: 200, duration_ms: 90, headline: "Sent", monitorId: "integration:1" }] }));
    expect((await listDeliveries("w1"))[0]).toMatchObject({ id: "d1", http_status: 200, monitorId: "integration:1" });
  });
  it("sends the test to the test route with the chosen record", async () => {
    const f = reply(200, { ok: true });
    use(f);
    await testWebhook("w 1", "acc1");
    expect(f.mock.calls[0][0]).toBe("/api/settings/webhooks-library/w%201/test");
    expect(JSON.parse(String((f.mock.calls[0][1] as unknown as RequestInit).body))).toEqual({ object_id: "acc1" });
  });
});
