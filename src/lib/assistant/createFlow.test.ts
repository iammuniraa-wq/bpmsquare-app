import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.hoisted(() => {
  process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
});

// The assistant's loop with create_record, the model and the database replaced. What is checked: the tool exists only
// when the flag, Nova, the module and the Business Role all allow it; it can only ever produce a card (no row is
// written, no route is run); and a card is never shown with a value the person did not give.

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => { throw new Error("no database in this test"); },
  requireTenantUser: async () => { throw new Error("not used"); },
  createServerSupabase: async () => { throw new Error("not used"); },
}));
vi.mock("@/lib/api/listSources", () => ({
  LIST_SOURCES: {
    accounts: {
      label: "Accounts", description: "companies", relatedWorkcenter: "accounts",
      fields: [{ path: "id", type: "string" }, { path: "name", type: "string", searchable: true }, { path: "city", type: "string" }],
      load: async () => [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Al-Otaibi Contracting", city: "Riyadh" }],
    },
  },
}));
vi.mock("@/lib/ai/reportCompile", () => ({ compileAndRun: vi.fn() }));
vi.mock("@/lib/marketing/leads/queries", () => ({ listScoredLeads: vi.fn(async () => ({ leads: [], pending: false })) }));
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn() }));

import { askAssistant, type AssistantAskCtx } from "@/lib/ai/assistant";
import { fakeAdmin, T1, type Row } from "@/lib/middleware/testHarness";
import { AssistantMeter } from "./meter";
import type { PermissionSet } from "@/lib/permissions";

const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const grant = (workcenter: "accounts" | "contacts", canCreate: boolean) => [workcenter, { workcenter, canView: true, canCreate, canEdit: false, canDelete: false }] as const;
const ON = { ai_assistant: true, ai_assistant_actions: true, next_experience: true, accounts: true, contacts: true };
const CURRENCY = { code: "SAR", symbol: "SAR", grouping: "standard" } as never;

type Reply = { content: unknown[]; stop_reason: string; usage: Record<string, number> };
const text = (t: string): Reply => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } });
const toolUse = (name: string, input: unknown, id = "tu1"): Reply => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 40 } });

function setup(opts: { features?: Record<string, boolean>; perms?: PermissionSet; userId?: string | undefined; replies?: Reply[]; accounts?: Row[]; route?: string } = {}) {
  const db = fakeAdmin({
    accounts: opts.accounts ?? [{ id: ACC, tenant_id: T1, name: "Al-Otaibi Contracting", ref: "ACC-0001", website: null }],
    contacts: [], custom_fields: [{ id: "cf-1", tenant_id: T1, object_type: "account", field_key: "cf_segment", field_label: "Segment", field_type: "select", options: ["Gold", "Silver"], is_required: false, position: 1, field_section: null }],
    field_overrides: [], field_rules: [], tenants: [{ id: T1, features: ON, config: {} }], assistant_actions: [], change_log: [],
  });
  const replies = [...(opts.replies ?? [text("ok")])];
  const params: Record<string, unknown>[] = [];
  const create = vi.fn(async (p: Record<string, unknown>) => {
    params.push(JSON.parse(JSON.stringify(p)));
    const r = replies.shift();
    if (!r) throw new Error("no scripted reply left");
    return r;
  });
  const meter = new AssistantMeter({ tenantId: T1, userId: "user-1", budget: 1_000_000 }, {
    allowanceFor: vi.fn(async () => ({ allowed: true, used: 0, budget: 1_000_000, remaining: 1_000_000 })),
    logUsage: vi.fn(async () => {}) as never,
  });
  const ctx: AssistantAskCtx = {
    supabase: db.client, tenantId: T1, perms: opts.perms ?? ALL, currency: CURRENCY, features: opts.features ?? ON,
    isAdmin: (opts.perms ?? ALL).unrestricted, route: opts.route ?? null, meter,
    anthropic: { messages: { create } } as unknown as Anthropic, now: new Date("2026-10-22T09:00:00Z"),
    ...("userId" in opts ? { userId: opts.userId } : { userId: "user-1" }),
  };
  return { ctx, db, params, create };
}
const ask = (q: string) => [{ role: "user" as const, text: q }];
const toolNames = (p: Record<string, unknown>) => (p.tools as { name: string }[]).map((t) => t.name);
const stable = (p: Record<string, unknown>) => (p.system as { text: string }[])[0].text;
const createEnum = (p: Record<string, unknown>) => ((p.tools as { name: string; input_schema: { properties: { object: { enum: string[] } } } }[]).find((t) => t.name === "create_record")?.input_schema.properties.object.enum) ?? [];

beforeEach(() => { vi.clearAllMocks(); });

describe("create_record is offered only when everything allows it", () => {
  it("not with the flag off: no tool, no field catalogue, and the prompt still says it cannot create", async () => {
    const s = setup({ features: { ...ON, ai_assistant_actions: false } });
    await askAssistant(ask("create an account Tesla Germany"), s.ctx);
    expect(toolNames(s.params[0])).not.toContain("create_record");
    expect(stable(s.params[0])).not.toContain("CREATABLE");
    expect(stable(s.params[0])).toContain("You cannot create, change or delete anything");
  });

  it("not without Nova, and not without a signed-in person to bind the card to", async () => {
    const noNova = setup({ features: { ...ON, next_experience: false } });
    await askAssistant(ask("create an account Tesla Germany"), noNova.ctx);
    expect(toolNames(noNova.params[0])).not.toContain("create_record");
    const anon = setup({ userId: undefined });
    await askAssistant(ask("create an account Tesla Germany"), anon.ctx);
    expect(toolNames(anon.params[0])).not.toContain("create_record");
  });

  it("with the flag on: the tool, and the workspace's own fields (custom ones too) in the cached prompt", async () => {
    const s = setup();
    await askAssistant(ask("create an account Tesla Germany"), s.ctx);
    expect(toolNames(s.params[0])).toContain("create_record");
    expect(createEnum(s.params[0])).toEqual(["account", "contact"]);
    const prompt = stable(s.params[0]);
    expect(prompt).toContain("CREATABLE objects");
    expect(prompt).toMatch(/name\* \(Name\)/);
    expect(prompt).toMatch(/type\* \(Type: prospect\|oem\|direct\|end_customer\)/);
    expect(prompt).toContain("cf_segment (Segment: Gold|Silver)");
    expect(prompt).toContain("account* (name of the account)");
    expect(prompt).toContain("nothing exists until the person presses the button");
  });

  it("only the objects whose module is on and whose create grant the role has", async () => {
    const noContactsModule = setup({ features: { ...ON, contacts: false } });
    await askAssistant(ask("create an account"), noContactsModule.ctx);
    expect(createEnum(noContactsModule.params[0])).toEqual(["account"]);

    const accountsOnlyGrant = setup({ perms: { unrestricted: false, grants: new Map([grant("accounts", true), grant("contacts", false)]) } });
    await askAssistant(ask("create an account"), accountsOnlyGrant.ctx);
    expect(createEnum(accountsOnlyGrant.params[0])).toEqual(["account"]);

    const viewOnly = setup({ perms: { unrestricted: false, grants: new Map([grant("accounts", false), grant("contacts", false)]) } });
    await askAssistant(ask("create an account"), viewOnly.ctx);
    expect(toolNames(viewOnly.params[0])).not.toContain("create_record");
  });
});

describe("what the tool does", () => {
  it("returns a card and writes nothing: no record, no audit row, no change history", async () => {
    const s = setup({ replies: [
      toolUse("create_record", { object: "account", summary: "Create the account Tesla Germany.", values: { name: "Tesla Germany", city: "Berlin", fax: "x" } }),
      text("Here is the card."),
    ] });
    const reply = await askAssistant(ask("create an account Tesla Germany in Berlin"), s.ctx);
    expect(reply.answer).toBe("Here is the card.");
    expect(reply.card).toMatchObject({ action: "create", object: "account", summary: "Create the account Tesla Germany.", primaryLabel: "Create account" });
    expect(reply.card?.fields.find((f) => f.key === "name")?.value).toBe("Tesla Germany");
    expect(reply.card?.fields.find((f) => f.key === "city")?.value).toBe("Berlin");
    expect(reply.card?.fields.find((f) => f.key === "industry")?.value).toBe("");
    expect(reply.card?.fields.some((f) => f.key === "fax")).toBe(false);
    expect(s.db.tables.accounts).toHaveLength(1);
    expect(s.db.tables.assistant_actions).toHaveLength(0);
    expect(s.db.tables.change_log).toHaveLength(0);
    const toolResult = JSON.stringify(s.params[1].messages);
    expect(toolResult).toContain("NOTHING is created yet");
    expect(toolResult).toContain("Ignored (not fields of this object): fax");
  });

  it("tells the model about a similar record so it can say so", async () => {
    const s = setup({ replies: [toolUse("create_record", { object: "account", summary: "s", values: { name: "Al-Otaibi Contracting Co" } }), text("ok")] });
    const reply = await askAssistant(ask("create an account Al-Otaibi Contracting Co"), s.ctx);
    expect(reply.card?.duplicates.map((d) => d.label)).toEqual(["Al-Otaibi Contracting (ACC-0001)"]);
    expect(JSON.stringify(s.params[1].messages)).toContain("Similar records already exist: Al-Otaibi Contracting (ACC-0001)");
  });

  it("an object the caller cannot create is refused with no card", async () => {
    const s = setup({ features: { ...ON, contacts: false }, replies: [toolUse("create_record", { object: "contact", summary: "s", values: { name: "Jane" }, references: { account: "Al-Otaibi" } }), text("Sorry.")] });
    const reply = await askAssistant(ask("add a contact Jane"), s.ctx);
    expect(reply.card).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain("you cannot create");
  });

  it("a contact whose account cannot be found gets no card: the model is told to ask", async () => {
    const s = setup({ replies: [toolUse("create_record", { object: "contact", summary: "s", values: { name: "Jane" }, references: { account: "Nowhere Ltd" } }), text("Which account?")] });
    const reply = await askAssistant(ask("add a contact Jane at Nowhere Ltd"), s.ctx);
    expect(reply.card).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain("No account matched");
  });

  it("on an account's page, a contact without a named account belongs to the account that is open", async () => {
    const s = setup({ route: `/accounts/${ACC}`, replies: [toolUse("create_record", { object: "contact", summary: "s", values: { name: "Jane Roe" } }), text("ok")] });
    const reply = await askAssistant(ask("add a contact Jane Roe here"), s.ctx);
    expect(reply.card?.fields.find((f) => f.key === "account_id")?.value).toBe(ACC);
  });

  it("one card at a time", async () => {
    const s = setup({ replies: [
      { content: [
        { type: "tool_use", id: "a", name: "create_record", input: { object: "account", summary: "one", values: { name: "One" } } },
        { type: "tool_use", id: "b", name: "create_record", input: { object: "account", summary: "two", values: { name: "Two" } } },
      ], stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 40 } },
      text("ok"),
    ] });
    const reply = await askAssistant(ask("create two accounts"), s.ctx);
    expect(reply.card?.title).toBe("New account: One");
    expect(JSON.stringify(s.params[1].messages)).toContain("one card at a time");
  });

  it("a model that calls create_record when the flag is off gets an unknown-tool error and no card", async () => {
    const s = setup({ features: { ...ON, ai_assistant_actions: false }, replies: [toolUse("create_record", { object: "account", summary: "s", values: { name: "X" } }), text("Cannot.")] });
    const reply = await askAssistant(ask("create an account X"), s.ctx);
    expect(reply.card).toBeUndefined();
    expect(JSON.stringify(s.params[1].messages)).toContain('unknown tool \\"create_record\\"');
    expect(s.db.tables.accounts).toHaveLength(1);
  });
});
