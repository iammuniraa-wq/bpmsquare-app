import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { createAdminSupabase } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb } from "@/lib/marketing/testFakeDb";
import {
  addTargets, contactBelongsToAccount, dealBelongsToAccount, isTenantMember, loadProgram, loadTarget, redactNotes, segmentExists, targetGroupExists, verifiedAccounts, type AbmCtx,
} from "./server";
import { loadFacts, refreshProgress } from "./progressServer";
import type { AbmProgram, AbmTargetAccount } from "./types";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const A_OWN = "a1111111-1111-4111-8111-111111111111";
const A_OWN2 = "a2222222-2222-4222-8222-222222222222";
const A_FOREIGN = "b1111111-1111-4111-8111-111111111111";
const P1 = "c1111111-1111-4111-8111-111111111111";
const P2 = "c2222222-2222-4222-8222-222222222222";
const TG1 = "d1111111-1111-4111-8111-111111111111";
const TG2 = "d2222222-2222-4222-8222-222222222222";
const K_OWN = "e1111111-1111-4111-8111-111111111111";
const K_FOREIGN = "e2222222-2222-4222-8222-222222222222";
const C_OWN = "f1111111-1111-4111-8111-111111111111";
const C_FOREIGN_TENANT = "f2222222-2222-4222-8222-222222222222";
const C_OTHER_ACCOUNT = "f3333333-3333-4333-8333-333333333333";
const D_OWN = "91111111-1111-4111-8111-111111111111";
const D_FOREIGN = "92222222-2222-4222-8222-222222222222";

// addTargets() upserts an array; the shared in-memory fake only understands one row at a time, so an
// array upsert is routed to its (array-capable) insert. Everything else is the fake as it is.
function arrayUpsertClient(db: ReturnType<typeof fakeDb>): SupabaseClient {
  const real = db.client;
  return { from: (table: string) => {
    const q = (real as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> }).from(table);
    const upsert = q.upsert.bind(q);
    q.upsert = (rows: unknown, opts: unknown) => (Array.isArray(rows) ? q.insert(rows) : upsert(rows, opts));
    return q;
  } } as unknown as SupabaseClient;
}

function world() {
  return fakeDb({
    accounts: [
      { id: A_OWN, tenant_id: T1, name: "Najd (sample)", city: "Riyadh" },
      { id: A_OWN2, tenant_id: T1, name: "Rawabi (sample)", city: "Riyadh" },
      { id: A_FOREIGN, tenant_id: T2, name: "Someone else's customer", city: "Doha" },
    ],
    abm_programs: [
      { id: P1, tenant_id: T1, name: "Mine", status: "active", required_roles: ["decision_maker"], owner_user_id: U1, default_tier: "one_to_many" },
      { id: P2, tenant_id: T2, name: "Theirs", status: "active", required_roles: ["decision_maker"], default_tier: "one_to_many" },
    ],
    abm_target_accounts: [
      { id: K_OWN, tenant_id: T1, program_id: P1, account_id: A_OWN, progress: "planned", tier: "one_to_many", created_at: "2026-09-01T00:00:00Z" },
      { id: K_FOREIGN, tenant_id: T2, program_id: P2, account_id: A_FOREIGN, progress: "planned", tier: "one_to_many", created_at: "2026-09-01T00:00:00Z" },
    ],
    contacts: [
      { id: C_OWN, tenant_id: T1, account_id: A_OWN, name: "Khalid" },
      { id: C_FOREIGN_TENANT, tenant_id: T2, account_id: A_FOREIGN, name: "Faisal" },
      { id: C_OTHER_ACCOUNT, tenant_id: T1, account_id: A_OWN2, name: "Noura" },
    ],
    opportunities: [
      { id: D_OWN, tenant_id: T1, account_id: A_OWN, ref: "OPP-0001", title: "Mine", outcome: "open" },
      { id: D_FOREIGN, tenant_id: T2, account_id: A_FOREIGN, ref: "OPP-0001", title: "Theirs", outcome: "open" },
    ],
    marketing_target_groups: [{ id: TG1, tenant_id: T1, name: "Mine" }, { id: TG2, tenant_id: T2, name: "Theirs" }],
    segments: [],
    tenant_users: [{ tenant_id: T1, user_id: U1 }],
    abm_buying_group_members: [],
    domain_event: [],
    change_log: [],
    teams: [],
    coverages: [],
  });
}

function ctx(db: ReturnType<typeof fakeDb>, tenantId = T1): AbmCtx {
  vi.mocked(createAdminSupabase).mockReturnValue(db.client as never);
  return { supabase: arrayUpsertClient(db), admin: db.client, tenantId, userId: U1, role: "admin", email: "u@x.example", can: { view: true, create: true, edit: true, delete: true } };
}

describe("tenant isolation", () => {
  it("another tenant's program or target id finds nothing", async () => {
    const db = world();
    const c = ctx(db);
    expect((await loadProgram(c, P2)).data).toBeNull();
    expect((await loadProgram(c, P1)).data?.name).toBe("Mine");
    expect((await loadTarget(c, K_FOREIGN)).data).toBeNull();
    expect((await loadTarget(c, K_OWN)).data?.id).toBe(K_OWN);
    expect((await loadTarget(c, "not-a-uuid")).data).toBeNull();
    for (const q of db.queries) expect(q.filters.tenant_id).toBe(T1);
  });

  it("a foreign or invented account id simply drops out", async () => {
    const db = world();
    const got = await verifiedAccounts(ctx(db), [A_OWN, A_FOREIGN, "not-a-uuid"]);
    expect(got.map((a) => a.id)).toEqual([A_OWN]);
  });

  it("a contact must be in this tenant AND at the target's own account", async () => {
    const db = world();
    const c = ctx(db);
    expect((await contactBelongsToAccount(c, C_OWN, A_OWN))?.name).toBe("Khalid");
    expect(await contactBelongsToAccount(c, C_FOREIGN_TENANT, A_OWN)).toBeNull();
    expect(await contactBelongsToAccount(c, C_OTHER_ACCOUNT, A_OWN)).toBeNull();
    expect(await contactBelongsToAccount(c, "nope", A_OWN)).toBeNull();
  });

  it("a deal must be in this tenant AND belong to the target's account", async () => {
    const db = world();
    const c = ctx(db);
    expect((await dealBelongsToAccount(c, D_OWN, A_OWN))?.ref).toBe("OPP-0001");
    expect(await dealBelongsToAccount(c, D_FOREIGN, A_OWN)).toBeNull();
    expect(await dealBelongsToAccount(c, D_OWN, A_OWN2)).toBeNull();
  });

  it("a target group, a segment and an owner must belong to this workspace", async () => {
    const db = world();
    const c = ctx(db);
    expect(await targetGroupExists(c, TG1)).toBe(true);
    expect(await targetGroupExists(c, TG2)).toBe(false);
    expect(await segmentExists(c, TG1)).toBe(false);
    expect(await isTenantMember(c, U1)).toBe(true);
    expect(await isTenantMember(c, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBe(false);
  });

  it("adding accounts: another tenant's account is not added, an existing one is skipped, the rest are stamped with this tenant and the program owner", async () => {
    const db = world();
    const c = ctx(db);
    const program = (await loadProgram(c, P1)).data as AbmProgram;
    const result = await addTargets(c, program, [A_OWN, A_OWN2, A_FOREIGN], "manual");
    expect(result).toMatchObject({ added: 1, already_in: 1, not_found: 1 });
    const rows = db.tables.abm_target_accounts.filter((r) => r.account_id === A_OWN2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: T1, program_id: P1, tier: "one_to_many", owner_user_id: U1, owner_source: "program", added_via: "manual" });
    expect(db.tables.abm_target_accounts.some((r) => r.account_id === A_FOREIGN && r.tenant_id === T1)).toBe(false);
    // The change history and the event stream both record it, for this tenant.
    expect(db.tables.change_log.every((r) => r.tenant_id === T1)).toBe(true);
    expect(db.tables.domain_event.some((e) => e.name === "abm.target.added" && e.tenant_id === T1)).toBe(true);
  });

  it("progress facts are read with the tenant filter on every query", async () => {
    const db = world();
    db.tables.abm_buying_group_members.push({ id: "m1", tenant_id: T1, target_account_id: K_OWN, contact_id: C_OWN, role: "decision_maker" });
    const c = ctx(db);
    const target = (await loadTarget(c, K_OWN)).data as AbmTargetAccount;
    const facts = await loadFacts(c, [target]);
    expect(facts.get(K_OWN)?.members).toHaveLength(1);
    for (const q of db.queries.filter((x) => x.table !== "abm_programs")) expect(q.filters.tenant_id, q.table).toBe(T1);
  });

  it("a rule-driven change is written for this tenant only, with the reason and no personal data in the event", async () => {
    const db = world();
    db.tables.abm_buying_group_members.push({ id: "m1", tenant_id: T1, target_account_id: K_OWN, contact_id: C_OWN, role: "decision_maker" });
    db.tables.domain_event.push({ id: "e1", tenant_id: T1, name: "email.delivered", contact_id: C_OWN, occurred_at: "2026-10-04T08:00:00Z" });
    db.tables.domain_event.push({ id: "e2", tenant_id: T2, name: "email.delivered", contact_id: C_OWN, occurred_at: "2026-10-05T08:00:00Z" });
    const c = ctx(db);
    const program = (await loadProgram(c, P1)).data as AbmProgram;
    const target = (await loadTarget(c, K_OWN)).data as AbmTargetAccount;
    const changed = await refreshProgress(c, program, [target], new Map([[A_OWN, "Najd (sample)"]]));
    expect(changed).toBe(1);
    const row = db.tables.abm_target_accounts.find((r) => r.id === K_OWN) as Record<string, unknown>;
    expect(row).toMatchObject({ progress: "reached", progress_source: "rule" });
    expect(String(row.progress_reason)).toContain("Khalid was sent an email, 4 Oct 2026");
    const ev = db.tables.domain_event.find((e) => e.name === "abm.target.progress_changed") as Record<string, unknown>;
    expect(ev.tenant_id).toBe(T1);
    expect(JSON.stringify(ev.payload)).not.toContain("Khalid");
    // the other tenant's row was untouched
    expect((db.tables.abm_target_accounts.find((r) => r.id === K_FOREIGN) as Record<string, unknown>).progress).toBe("planned");
  });
});

describe("change history", () => {
  it("logs a private note as changed, never as its text", () => {
    const out = redactNotes([{ field: "notes", from: null, to: "Prefers WhatsApp" }, { field: "tier", from: "one_to_many", to: "one_to_one" }]);
    expect(JSON.stringify(out)).not.toContain("WhatsApp");
    expect(out[0]).toMatchObject({ field: "notes", to: "[note]", redacted: true });
    expect(out[1]).toMatchObject({ field: "tier", to: "one_to_one" });
  });
});

describe("a pending migration", () => {
  it("reads as missing, not as an error", async () => {
    const db = fakeDb({}, { missingTables: ["abm_programs", "abm_target_accounts"] });
    const c = ctx(db);
    expect(await loadProgram(c, P1)).toEqual({ data: null, missing: true });
    expect(await loadTarget(c, K_OWN)).toEqual({ data: null, missing: true });
  });
});
