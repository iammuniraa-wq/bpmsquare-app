import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { tipTextProblems } from "@/lib/infoTip";
import {
  normalizeDocument, normalizeHealth, normalizeMessage,
  type DocumentView, type MonitorMessage, type PayloadView, type RestartResult, type SyncEntity,
} from "./api";
import {
  documentStatus, documentsConfirmed, draftFromDocument, draftPatch, draftProblem, isDraftDirty, priceListChanged, showsFallbackPriceList, targetOptions,
} from "./documentsLogic";
import { buildLinks } from "./linksLogic";
import { addressWord, expiryChip, healthBanner, summarizeTest, testOutcome } from "./connectionLogic";
import {
  actionBar, filterAsRecord, matchesDocument, payloadLine, payloadText, prettyBody, pruneTicks, resultLine, resultsSummary, toggleAll, toggleTick,
} from "./monitorSelection";
import { filtersToQuery } from "./monitorLogic";
import { lastRunLine, parseRecordIds, whenWord } from "./resyncLogic";
import { createPickSaver } from "./pickSaver";
import { TAB_IDS } from "./setup";
import { MIDDLEWARE_TIPS } from "./tips";
import { MiddlewareProvider, type MiddlewareCtx } from "./context";
import { LinkPanel, LinksTable } from "./LinksTab";
import { FilterRow, MonitorList } from "./MonitorTab";
import { EntityRows } from "./ResyncTab";

// createElement's overloads reject a component whose required props come loose; the render checks are closed-state markup.
const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e);

// ── Fixtures ────────────────────────────────────────────────────────────────

const quoteDoc = (over: Partial<DocumentView> = {}): DocumentView => ({
  key: "quote", label: "Quote", source: "standard_quote", enabled: true, summary: "Awarded → Dynamics 365 Quote",
  target: { key: "quote", label: "Quote" },
  targets: [
    { key: "quote", label: "Quote", available: true, hint: null },
    { key: "sales_order", label: "Sales Order", available: true, hint: null },
    { key: "project", label: "Project", available: false, hint: "Not ready for this ERP yet." },
  ],
  include: [
    { key: "prices", label: "Customer prices", on: true, allowed: true, hint: null },
    { key: "summary", label: "Summary text", on: true, allowed: true, hint: null },
    { key: "bom", label: "Materials list", on: false, allowed: false, hint: "Prices only here" },
  ],
  fallbackPriceListId: null, showFallbackPriceList: null, confirmedAt: null, ...over,
});

const msg = (over: Partial<MonitorMessage> = {}): MonitorMessage => ({
  id: "integration:1", source: "integration", at: "2026-10-21T10:00:00Z", direction: "out", channel: "connector", counterpart: "Dynamics 365",
  summary: "SQ-0001 awarded", status: "failed", record: { type: "standard_quotes", id: "q1", label: "SQ-0001" }, duration_ms: 900,
  what: "Quote", erpNumber: null, restartable: true, fix: "Sync customers, then restart.", hasPayload: true, ...over,
});

// ── What goes out ───────────────────────────────────────────────────────────

describe("the link panel's draft", () => {
  it("is clean until something changes, and sends only what changed", () => {
    const d = quoteDoc();
    const draft = draftFromDocument(d);
    expect(isDraftDirty(d, draft)).toBe(false);
    expect(draftPatch(d, draft)).toEqual({});
    const changed = { ...draft, target: "sales_order", include: { ...draft.include, summary: false } };
    expect(draftPatch(d, changed)).toEqual({ target: "sales_order", include: { summary: false } });
    expect(isDraftDirty(d, changed)).toBe(true);
  });
  it("has no 'when' and no automatic/manual choice to save", () => {
    const patch = draftPatch(quoteDoc(), { ...draftFromDocument(quoteDoc()), target: "sales_order" });
    expect(Object.keys(patch)).toEqual(["target"]);
  });
  it("never sends a greyed item, even when it was ticked in the draft", () => {
    const d = quoteDoc();
    const draft = { ...draftFromDocument(d), include: { prices: true, summary: true, bom: true } };
    expect(draftPatch(d, draft).include).toBeUndefined();
  });
  it("refuses a save for an unavailable target, in words", () => {
    const d = quoteDoc();
    const base = draftFromDocument(d);
    expect(draftProblem(d, base)).toBeNull();
    expect(draftProblem(d, { ...base, target: "project" })).toBe("Not ready for this ERP yet.");
  });
  it("shows the fallback price list only for a Dynamics Quote or Sales Order, and tracks its change", () => {
    expect(showsFallbackPriceList("dataverse", "quote")).toBe(true);
    expect(showsFallbackPriceList("dataverse", "sales_order")).toBe(true);
    expect(showsFallbackPriceList("dataverse", "project")).toBe(false);
    expect(showsFallbackPriceList("fo", "quote")).toBe(false);
    expect(showsFallbackPriceList(null, "quote")).toBe(false);
    const d = quoteDoc();
    expect(priceListChanged("p1", draftFromDocument(d, "p1"))).toBe(false);
    expect(isDraftDirty(d, draftFromDocument(d, "p2"), "p1")).toBe(true);
    expect(isDraftDirty(d, draftFromDocument(d, ""), undefined)).toBe(false);
  });
  it("saves the fallback price list on the document itself, and clears it with null", () => {
    const d = quoteDoc({ fallbackPriceListId: "p1", showFallbackPriceList: true });
    expect(draftFromDocument(d).priceList).toBe("p1");
    expect(draftPatch(d, draftFromDocument(d))).toEqual({});
    expect(draftPatch(d, { ...draftFromDocument(d), priceList: "p2" })).toEqual({ fallbackPriceListId: "p2" });
    expect(draftPatch(d, { ...draftFromDocument(d), priceList: "" })).toEqual({ fallbackPriceListId: null });
    expect(showsFallbackPriceList("fo", "quote", d)).toBe(true);
    expect(showsFallbackPriceList("dataverse", "project", d)).toBe(false);
  });
  it("words the status dot", () => {
    expect(documentStatus({ enabled: false }, true)).toBe("off");
    expect(documentStatus({ enabled: true }, true)).toBe("ok");
    expect(documentStatus({ enabled: true }, false)).toBe("attention");
  });
  it("keeps an unavailable target visible but disabled, with its hint", () => {
    const o = targetOptions(quoteDoc());
    expect(o.map((x) => x.key)).toEqual(["quote", "sales_order", "project"]);
    expect(o[2]).toMatchObject({ disabled: true, hint: "Not ready for this ERP yet." });
    expect(o[1].disabled).toBe(false);
  });
  it("turns the set-up tick on only after a save", () => {
    expect(documentsConfirmed([quoteDoc()])).toBe(false);
    expect(documentsConfirmed([quoteDoc({ confirmedAt: "2026-10-21T10:00:00Z" })])).toBe(true);
    expect(documentsConfirmed([quoteDoc({ confirmedAt: "2026-10-21T10:00:00Z", enabled: false })])).toBe(false);
    expect(documentsConfirmed(null)).toBe(false);
  });
  it("reads the contract and fills what the server left out", () => {
    const d = normalizeDocument({ key: "quote", confirmed_at: "2026-10-21T10:00:00Z", enabled: true });
    expect(d.confirmedAt).toBe("2026-10-21T10:00:00Z");
    expect(d.targets).toEqual([]);
    expect(normalizeDocument({ key: "quote" }, "2026-01-01T00:00:00Z").confirmedAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("the Links rows", () => {
  const ent = (key: string, schedule: SyncEntity["schedule"], enabled = true): SyncEntity => ({ key: key as never, label: key, direction: "pull", enabled, entity_set: "x", schedule, schedule_source: "entity", running: false, linked: 0, last_run: null });
  const rows = buildLinks([quoteDoc()], [ent("customers", "daily"), ent("contacts", "hourly"), ent("products", "off", false), ent("projects", "off"), ent("fence_projects", "off"), ent("vendors", "off")]);
  it("lists the Standard Quote first, then the four inbound links in order, and nothing else", () => {
    expect(rows.map((r) => `${r.bpm}|${r.erp}|${r.runs}`)).toEqual([
      "Standard Quote|Quote|When awarded", "Accounts|Customers|Daily", "Contacts|Contacts|Hourly", "Products|Products|Off", "Projects|Projects|Off",
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["out", "in", "in", "in", "in"]);
  });
  it("carries the On state of each link", () => {
    expect(rows.map((r) => r.enabled)).toEqual([true, true, true, false, true]);
  });
  it("leaves out an inbound link the product does not have", () => {
    expect(buildLinks([quoteDoc()], []).map((r) => r.kind)).toEqual(["out"]);
  });
});

describe("the connection panel's words", () => {
  const chk = (id: string, ok: boolean | null, fix: string | null = null) => ({ id, label: `Check ${id}`, ok, fix });
  it("tells a clean test in one line, with no details", () => {
    const o = summarizeTest({ ok: true, message: "OK" }, [chk("a", true), chk("b", true)]);
    expect(o).toEqual({ ok: true, line: "The connection and the permissions are fine.", failures: [] });
  });
  it("tells a refused sign-in in one line and keeps the ERP's message for the details", () => {
    const o = summarizeTest({ ok: false, message: "Invalid client secret" }, null);
    expect(o.ok).toBe(false);
    expect(o.line).toBe("Could not connect.");
    expect(o.failures).toEqual([{ label: "Invalid client secret", fix: null }]);
  });
  it("names how many permissions are missing and lists only those behind the toggle", () => {
    const o = summarizeTest({ ok: true, message: null }, [chk("a", true), chk("b", false, "Give the app user the Salesperson role"), chk("c", false)]);
    expect(o.ok).toBe(false);
    expect(o.line).toBe("The connection works, but 2 permissions are missing.");
    expect(o.failures.map((f) => f.label)).toEqual(["Check b", "Check c"]);
    expect(summarizeTest({ ok: true, message: null }, [chk("a", false)]).line).toContain("1 permission is missing");
  });
  it("does not call a permission it could not confirm a failure", () => {
    const o = summarizeTest({ ok: true, message: null }, [chk("a", true), chk("b", null)]);
    expect(o.ok).toBe(true);
    expect(o.failures).toEqual([]);
    expect(o.line).toContain("test quote");
  });
  it("says the connection works when the permission probes themselves could not run", () => {
    const o = summarizeTest({ ok: true, message: null }, null, "Not installed");
    expect(o.ok).toBe(true);
    expect(o.failures).toHaveLength(1);
  });
  it("shows the address without its scheme", () => {
    expect(addressWord("https://contoso.crm4.dynamics.com/")).toBe("contoso.crm4.dynamics.com");
    expect(addressWord(undefined)).toBe("");
  });
  it("shows the server's one Test line as it is, with only the failures behind the toggle", () => {
    const o = testOutcome({ ok: false, line: "Connected, but 1 thing needs fixing.", failures: [{ label: "Create quotes", fix: "Give the app user a role that includes this, then test again." }] });
    expect(o.ok).toBe(false);
    expect(o.line).toBe("Connected, but 1 thing needs fixing.");
    expect(o.failures).toHaveLength(1);
    expect(testOutcome({ ok: true, line: "Connected. Everything needed is allowed.", failures: [] }).failures).toEqual([]);
  });
  it("shows the expiry chip only within 30 days", () => {
    expect(expiryChip({ secretSoon: null })).toBeNull();
    expect(expiryChip({ secretSoon: { days: 12 } })).toBe("Secret ends in 12 days");
    expect(expiryChip({ secretSoon: { days: 1 } })).toBe("Secret ends in 1 day");
    expect(expiryChip({ secretSoon: { days: 0 } })).toBe("Secret ends today");
    expect(expiryChip(undefined)).toBeNull();
  });
  it("shows one warning banner only when something is missing, naming the SQL file", () => {
    expect(healthBanner(null)).toBeNull();
    expect(healthBanner({ problems: [] })).toBeNull();
    expect(healthBanner({ problems: [{ kind: "database", message: "A database update is needed (Message log).", bundle: "0201_integration_middleware.sql" }] }))
      .toBe("A database update is needed (Message log): run 0201_integration_middleware.sql once, then reload.");
    expect(healthBanner({ problems: [{ kind: "secret", message: "The Dynamics client secret has expired.", bundle: null }] })).toBe("The Dynamics client secret has expired.");
  });
  it("reads the health answer, old shape or new", () => {
    const fresh = normalizeHealth({ problems: [], secretSoon: { days: 9 }, connection: { connected: true, product: { key: "dataverse", name: "Dynamics 365 Sales" } } });
    expect(fresh).toEqual({ problems: [], secretSoon: { days: 9 }, connection: { connected: true, product: { key: "dataverse", name: "Dynamics 365 Sales" } } });
    const old = normalizeHealth({ schema: [{ label: "Message log", exists: false, bundle: "0201.sql" }], secret: { state: "expired", days_left: -2 }, connection: { state: "error", last_error: "401", product: null } });
    expect(old.problems.map((p) => p.kind)).toEqual(["database", "connection", "secret"]);
    expect(old.problems[0].bundle).toBe("0201.sql");
    expect(old.secretSoon).toBeNull();
    expect(old.connection.connected).toBe(false);
    expect(normalizeHealth({}).problems).toEqual([]);
  });
});

describe("the page frame", () => {
  it("has four tabs: Links, Mapping, Monitor, Resync; no Connections tab", () => {
    expect([...TAB_IDS]).toEqual(["links", "mapping", "monitor", "resync"]);
  });
});

// ── Monitor ─────────────────────────────────────────────────────────────────

describe("ticking lines", () => {
  const items = [msg({ id: "a" }), msg({ id: "b" }), msg({ id: "c", restartable: false, status: "ok" })];
  it("every line can be ticked, an OK line included (to read its payload)", () => {
    expect(toggleTick([], items, "a")).toEqual(["a"]);
    expect(toggleTick(["a"], items, "a")).toEqual([]);
    expect(toggleTick([], items, "c")).toEqual(["c"]);
    expect(toggleTick([], items, "zzz")).toEqual([]);
  });
  it("select-all covers every loaded line and a second press clears them", () => {
    expect(toggleAll([], items)).toEqual(["a", "b", "c"]);
    expect(toggleAll(["a", "b", "c"], items)).toEqual([]);
    expect(toggleAll(["a"], items)).toEqual(["a", "b", "c"]);
  });
  it("drops a tick on a line that is no longer there", () => {
    expect(pruneTicks(["a", "c", "zzz"], items)).toEqual(["a", "c"]);
  });
  it("Restart acts only on the ticked lines that can be restarted", () => {
    expect(actionBar(items, ["c"], {}, false).restartEnabled).toBe(false);
    expect(actionBar(items, ["a", "c"], {}, false)).toMatchObject({ restartEnabled: true, restartLabel: "Restart" });
  });
});

describe("the action bar", () => {
  const items = [msg({ id: "a" }), msg({ id: "b", hasPayload: false }), msg({ id: "c", restartable: false, status: "ok" })];
  it("with nothing ticked: Restart is off and both view buttons say 'Select one line'", () => {
    const b = actionBar(items, [], {}, false);
    expect(b.restartEnabled).toBe(false);
    expect(b.viewRequest).toEqual({ disabled: true, reason: "Select one line" });
    expect(b.viewResponse.reason).toBe("Select one line");
  });
  it("with one ticked: Restart and both view buttons are on", () => {
    const b = actionBar(items, ["a"], {}, false);
    expect(b).toMatchObject({ restartEnabled: true, restartMode: "ticked", restartLabel: "Restart" });
    expect(b.viewRequest.disabled).toBe(false);
    expect(b.viewResponse.disabled).toBe(false);
    expect(b.one?.id).toBe("a");
  });
  it("with several ticked: the view buttons are off again and Restart counts them", () => {
    const b = actionBar(items, ["a", "b"], {}, false);
    expect(b.restartLabel).toBe("Restart (2)");
    expect(b.viewRequest).toEqual({ disabled: true, reason: "Select one line" });
  });
  it("with one ticked and no payload recorded: the view buttons say so", () => {
    expect(actionBar(items, ["b"], {}, false).viewResponse).toEqual({ disabled: true, reason: "No payload recorded" });
  });
  it("offers 'Restart all failed (n)' only with a Failed filter and nothing ticked", () => {
    expect(actionBar(items, [], { status: "failed" }, false)).toMatchObject({ restartMode: "all-failed", restartLabel: "Restart all failed (2)" });
    expect(actionBar(items, [], { status: "failed" }, true).restartLabel).toBe("Restart all failed (2+)");
    expect(actionBar(items, ["a"], { status: "failed" }, false).restartMode).toBe("ticked");
    expect(actionBar([msg({ id: "z", restartable: false })], [], { status: "failed" }, false).restartMode).toBe("none");
  });
  it("narrows the loaded lines by document or entity, by the row's own word", () => {
    expect(matchesDocument(msg({ what: "Quote" }), "quote")).toBe(true);
    expect(matchesDocument(msg({ what: "Customers" }), "quote")).toBe(false);
    expect(matchesDocument(msg({ what: null }), undefined)).toBe(true);
    expect(matchesDocument(msg({ what: "customers" }), "customers")).toBe(true);
  });
  it("hands the restart route the same names as the list query", () => {
    expect(filterAsRecord({ status: "failed", document: "quote", q: " SQ-1 " })).toEqual({ status: "failed", document: "quote", q: "SQ-1" });
    expect(filtersToQuery({ document: "not valid!" })).toBe("");
  });
});

describe("what a restart answered", () => {
  const r = (outcome: RestartResult["outcome"], message = ""): RestartResult => ({ id: "x", outcome, message });
  it("says it per line in plain words", () => {
    expect(resultLine(r("done", "Sent."))).toBe("Done");
    expect(resultLine(r("failed", "Customer is not in Dynamics yet."))).toBe("Still failing: Customer is not in Dynamics yet.");
    expect(resultLine(r("already_ok"))).toBe("Already fine");
    expect(resultLine(r("not_restartable", "Skipped by design."))).toBe("Cannot be restarted: Skipped by design.");
  });
  it("sums up the whole restart in one line", () => {
    expect(resultsSummary([r("done"), r("done"), r("failed")])).toBe("2 done, 1 still failing.");
    expect(resultsSummary([])).toBe("Nothing was restarted.");
  });
});

describe("payload words", () => {
  const p: PayloadView = {
    request: { method: "POST", url: "/quotes", body: { name: "SQ-1" } },
    response: { status: 201, body: '{"quotenumber":"QUO-1"}', durationMs: 1234 },
    truncated: false,
  };
  it("pretty-prints an object and a JSON string, and shows other text as it is", () => {
    expect(prettyBody({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyBody('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyBody("plain text")).toBe("plain text");
    expect(prettyBody(null)).toBe("No body.");
  });
  it("puts the status and duration in one line", () => {
    expect(payloadLine(p, "response")).toBe("HTTP 201 · 1.2 s");
    expect(payloadLine(p, "request")).toBe("POST /quotes");
    expect(payloadLine({ ...p, response: null }, "response")).toBe("");
    expect(payloadText(p, "response")).toContain("QUO-1");
  });
});

describe("the list item contract", () => {
  it("reads the label from whichever name the source used and defaults the new fields", () => {
    expect(normalizeMessage({ id: "x", entity: "Customers" }).what).toBe("Customers");
    expect(normalizeMessage({ id: "x", document: "Quote" }).what).toBe("Quote");
    const m = normalizeMessage({ id: "x" });
    expect(m).toMatchObject({ restartable: false, fix: null, erpNumber: null, hasPayload: false, what: null });
  });
});

// ── Resync ──────────────────────────────────────────────────────────────────

describe("the Resync tab's words", () => {
  const now = new Date(2026, 9, 21, 18, 0, 0);
  const at = (h: number, m: number, dayOffset = 0) => new Date(2026, 9, 21 + dayOffset, h, m, 0).toISOString();
  it("says when in one short phrase", () => {
    expect(whenWord(at(17, 29), now)).toBe("Today 17:29");
    expect(whenWord(at(9, 5, -1), now)).toBe("Yesterday 09:05");
    expect(whenWord(at(9, 5, -5), now)).toMatch(/^16 Oct$/);
  });
  it("gives the last run as one line", () => {
    const run = (status: string, counts: Record<string, number> | null) => ({ running: false, last_run: { status, trigger: "manual", started_at: at(17, 29), finished_at: at(17, 29), counts, error: null } });
    expect(lastRunLine(run("succeeded", { read: 6, created: 2 }), now)).toBe("Today 17:29, 6 records");
    expect(lastRunLine(run("succeeded", { read: 1 }), now)).toBe("Today 17:29, 1 record");
    expect(lastRunLine(run("failed", null), now)).toBe("Today 17:29, failed");
    expect(lastRunLine({ running: false, last_run: null }, now)).toBe("Not run yet");
    expect(lastRunLine({ running: true, last_run: null }, now)).toBe("Running now");
  });
  it("reads ids or numbers typed with commas, spaces or lines", () => {
    expect(parseRecordIds("A-1, A-2\nA-3  A-1;")).toEqual(["A-1", "A-2", "A-3"]);
    expect(parseRecordIds("  ")).toEqual([]);
  });
});

// ── Connections: price list and currency ────────────────────────────────────

describe("choosing two settings one right after the other", () => {
  it("keeps both: every save carries everything chosen so far, in order", async () => {
    const saved: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    const saver = createPickSaver(async (snapshot) => {
      if (first) { first = false; await gate; }
      saved.push(snapshot);
    });
    const a = saver.choose({ price_list_id: "P1" });
    const b = saver.choose({ currency_id: "C1" });
    release();
    await Promise.all([a, b]);
    expect(saved).toEqual([{ price_list_id: "P1" }, { price_list_id: "P1", currency_id: "C1" }]);
    expect(saver.chosen()).toEqual({ price_list_id: "P1", currency_id: "C1" });
  });
  it("a failed first save does not stop the second, which still carries both", async () => {
    const saved: unknown[] = [];
    let n = 0;
    const saver = createPickSaver(async (snapshot) => { if (n++ === 0) throw new Error("no"); saved.push(snapshot); });
    const a = saver.choose({ price_list_id: "P1" }).catch(() => undefined);
    const b = saver.choose({ currency_id: "C1" });
    await Promise.all([a, b]);
    expect(saved).toEqual([{ price_list_id: "P1", currency_id: "C1" }]);
  });
  it("the form updates its state with functions, never from a value read earlier", async () => {
    const { readFileSync } = await import("node:fs");
    const form = readFileSync(new URL("./ConnectionForm.tsx", import.meta.url), "utf8");
    expect(form).not.toMatch(/setSecrets\(\{\s*\.\.\.secrets/);
    expect(form).not.toMatch(/setCfg\(\{\s*\.\.\.cfg/);
    expect(form).toContain("setSecrets((x) => ({ ...x, [key]: value }))");
    expect(form).toContain("setCfg((x) => ({ ...x, ...p }))");
  });
});

// ── The explanations ────────────────────────────────────────────────────────

describe("the texts of the redesigned tabs", () => {
  it("every explanation fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(MIDDLEWARE_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});

// ── Render checks (closed-state markup) ─────────────────────────────────────

const ctx = (): MiddlewareCtx => {
  const piece = <T,>(data: T | null) => ({ data, setData: () => undefined, error: null, loading: false, reload: async () => undefined });
  return {
    connector: { id: "dynamics365", name: "Microsoft Dynamics 365", shortName: "Dynamics 365" },
    connection: null, connections: piece(null), health: piece(null), rules: piece(null), documents: piece({ documents: [quoteDoc()] }), sync: piece(null),
    evidence: { testSent: false, realSeen: false }, reloadEvidence: async () => undefined, goTab: () => undefined, openConnection: () => undefined, reloadAll: async () => undefined,
  } as unknown as MiddlewareCtx;
};

describe("Links", () => {
  const ent = (key: string, schedule: SyncEntity["schedule"]): SyncEntity => ({ key: key as never, label: key, direction: "pull", enabled: true, entity_set: "x", schedule, schedule_source: "entity", running: false, linked: 0, last_run: null });
  const rows = buildLinks([quoteDoc()], [ent("customers", "daily"), ent("contacts", "hourly"), ent("products", "off"), ent("projects", "off")]);
  const table = html(el(LinksTable, { rows, connected: true, busy: null, onOpen: () => undefined, onToggle: () => undefined, onTest: () => undefined }));
  it("is one table: BPMSquare, arrow, ERP, Runs, On", () => {
    for (const h of ["BPMSquare", "ERP", "Runs", "On"]) expect(table).toContain(`<th>${h}</th>`);
    expect(table.match(/<tr class="[^"]*">\s*<td/g)?.length ?? (table.match(/docRow/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(table).toContain("Standard Quote");
    expect(table).toContain("When awarded");
    expect(table).toContain("Daily");
    expect(table).toContain("→");
    expect(table).toContain("←");
    expect(table.match(/role="switch"/g)).toHaveLength(5);
  });
  it("opens only the outbound row, and an inbound row is just its switch", () => {
    expect(table.match(/change what it becomes in the ERP/g)).toHaveLength(1);
  });
  it("has no awarded/rejected ticks, no automatic/manual choice and no block per activity", () => {
    for (const word of ["Automatic", "Manual", "Rejected", "Fence", "Estimate", "Check a quote", "Send when"]) expect(table).not.toContain(word);
  });
  it("opens a small panel with only Create as, Include and Try it, and no schedule of when", () => {
    const panel = html(el(MiddlewareProvider, { value: ctx() }, el(LinkPanel, { doc: quoteDoc(), connected: true, onClose: () => undefined, onSaved: () => undefined })));
    for (const label of ['aria-label="Create as"', 'aria-label="Include"', 'aria-label="Try it"']) expect(panel).toContain(label);
    expect(panel.match(/<section/g)).toHaveLength(3);
    for (const word of ["Send when", "Automatically", "Manually", "Rejected"]) expect(panel).not.toContain(word);
    expect(panel).toContain("Sales Order");
    expect(panel).toContain("Prices only here");
    expect(panel).toContain("Preview");
    expect(panel).toContain("Send a quote now");
    expect(panel).toContain("Save");
  });
});

describe("Monitor", () => {
  const items = [msg({ id: "a" }), msg({ id: "b", restartable: false, status: "ok", fix: null, erpNumber: "QUO-01002" })];
  const list = html(el(MonitorList, { items, ticked: [], results: { a: { id: "a", outcome: "failed", message: "Still no customer." } }, system: "Dynamics 365", onTick: () => undefined, onAll: () => undefined }));
  it("gives every line a tick box, plus select-all", () => {
    expect(list).toContain("Select all lines");
    expect((list.match(/aria-label="Select Quote SQ-0001"/g) ?? []).length).toBe(4);
  });
  it("keeps the reason off the screen until a line is opened: only the ERP number and a Why control show", () => {
    expect(list).toContain("QUO-01002");
    expect(list).toContain("Why: Quote SQ-0001");
    expect(list).not.toContain("What to do:");
    expect(list).not.toContain("Still failing: Still no customer.");
    expect(list).not.toContain(">Reason<");
  });
  it("opens the reason, the 'what to do' line and the answer of a restart under the line", () => {
    const opened = html(el(MonitorList, { items, ticked: [], results: { a: { id: "a", outcome: "failed", message: "Still no customer." } }, system: "Dynamics 365", onTick: () => undefined, onAll: () => undefined, initialOpen: ["a"] }));
    expect(opened).toContain("What to do:");
    expect(opened).toContain("Sync customers, then restart.");
    expect(opened).toContain("Still failing: Still no customer.");
  });
  it("draws no request or response body anywhere in the list", () => {
    expect(list).not.toContain("quotenumber");
  });
  it("has the status chips, direction, document, dates and search in the filter row", () => {
    const f = html(el(FilterRow, { filters: {}, onChange: () => undefined, onClear: () => undefined, problem: null }));
    for (const w of ["All", "Failed", "Waiting", "OK", 'aria-label="Direction"', 'aria-label="Document or entity"', 'aria-label="From date"', 'aria-label="To date"', "Search by record or ERP number"]) expect(f).toContain(w);
  });
});

describe("Resync", () => {
  const e = (key: string): SyncEntity => ({ key: key as never, label: key, direction: "pull", enabled: true, entity_set: "accounts", schedule: "hourly", schedule_source: "entity", running: false, linked: 3, last_run: null });
  const out = html(el(EntityRows, { rows: [e("customers"), e("contacts")], connected: true, busy: null, lines: {}, onlyOpen: {}, only: {}, onSync: () => undefined, onSchedule: () => undefined, onToggleOnly: () => undefined, onOnly: () => undefined }));
  it("is one short table with a schedule and two buttons per entity", () => {
    expect(out).toContain("Customers");
    expect(out).toContain("Contacts");
    expect(out.match(/Sync now/g)).toHaveLength(2);
    expect(out.match(/Full resync/g)).toHaveLength(2);
    expect(out).toContain("Hourly");
    expect(out).toContain("Not run yet");
  });
  it("carries no history, failed list or payload", () => {
    for (const w of ["Recent runs", "Needs attention", "Retry", "payload"]) expect(out).not.toContain(w);
  });
});
