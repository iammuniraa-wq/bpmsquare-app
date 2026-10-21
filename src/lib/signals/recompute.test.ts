import { describe, expect, it } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { recomputeTenant } from "./recompute";
import { getBuyingStage } from "./stage";

const A = "tenant-a";
const B = "tenant-b";
const NOW = new Date("2026-10-20T12:00:00Z");
const daysAgo = (n: number, from = NOW) => new Date(from.getTime() - n * 86_400_000).toISOString();

const baseSeed = (): Record<string, Row[]> => ({
  accounts: [
    { id: "acc-1", tenant_id: A, name: "Najd Precast Co.", owner_user_id: "user-1" },
    { id: "acc-2", tenant_id: A, name: "Quiet Ltd", owner_user_id: null },
    { id: "acc-b", tenant_id: B, name: "Other Tenant Co.", owner_user_id: null },
  ],
  quotes: [
    { id: "q1", tenant_id: A, ref: "QT-1", account_id: "acc-1", outcome: "open", created_at: daysAgo(10) },
    { id: "q9", tenant_id: B, ref: "QT-9", account_id: "acc-b", outcome: "open", created_at: daysAgo(2) },
  ],
  tenant_users: [{ tenant_id: A, user_id: "user-1" }],
});

const ownerEmail = async () => "owner@example.com";

describe("recomputeTenant", () => {
  it("scores the tenant's accounts, stores the row and the day's history, and leaves other tenants alone", async () => {
    const { client, tables } = fakeDb(baseSeed());
    const r = await recomputeTenant(client, A, { now: NOW, resolveOwnerEmail: ownerEmail });
    expect(r.scored).toBe(1);
    const intent = tables.account_intent;
    expect(intent).toHaveLength(1);
    expect(intent[0]).toMatchObject({ tenant_id: A, account_id: "acc-1", stage: "comparing" });
    // 25 (asked for a quote) + 10 (open for 10 days)
    expect(intent[0].score).toBe(35);
    expect(tables.account_intent_history).toEqual([expect.objectContaining({ tenant_id: A, account_id: "acc-1", day: "2026-10-20", score: 35 })]);
    expect(tables.account_intent.some((x) => x.tenant_id === B)).toBe(false);
  });

  it("is idempotent: a second run the same day changes nothing and says nothing twice", async () => {
    const { client, tables } = fakeDb(baseSeed());
    await recomputeTenant(client, A, { now: NOW, resolveOwnerEmail: ownerEmail });
    const second = await recomputeTenant(client, A, { now: new Date(NOW.getTime() + 3_600_000), resolveOwnerEmail: ownerEmail });
    expect(second.stageChanges).toBe(0);
    expect(second.alerts).toBe(0);
    expect(tables.account_intent).toHaveLength(1);
    expect(tables.account_intent_history).toHaveLength(1);
    expect(tables.domain_event.filter((e) => e.name === "account.buying_stage_changed")).toHaveLength(1);
  });

  it("emits account.buying_stage_changed once per change, with from, to and score", async () => {
    const { client, tables } = fakeDb(baseSeed());
    await recomputeTenant(client, A, { now: NOW, resolveOwnerEmail: ownerEmail });
    // Ten days later the 25-point ask has faded and the quote has aged out of its fresh window.
    const later = new Date(NOW.getTime() + 40 * 86_400_000);
    await recomputeTenant(client, A, { now: later, resolveOwnerEmail: ownerEmail });
    const ev = tables.domain_event.filter((e) => e.name === "account.buying_stage_changed");
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ tenant_id: A, account_id: "acc-1", object_type: "account", payload: { from: "quiet", to: "comparing", score: 35 } });
    expect((ev[1].payload as { to: string }).to).not.toBe("comparing");
    expect(tables.account_intent[0].previous_stage).toBe("comparing");
  });

  it("sets a baseline on the first run and alerts the owner only when an account later moves up", async () => {
    const { client, tables } = fakeDb(baseSeed());
    const first = await recomputeTenant(client, A, { now: NOW, resolveOwnerEmail: ownerEmail });
    expect(first.baseline).toBe(true);
    expect(first.alerts).toBe(0);

    // Quiet Ltd now asks for a quote: Quiet -> Comparing, with an owner.
    tables.accounts.find((a) => a.id === "acc-2")!.owner_user_id = "user-1";
    tables.quotes.push({ id: "q2", tenant_id: A, ref: "QT-2", account_id: "acc-2", outcome: "open", created_at: daysAgo(1) });
    // Existing intent for acc-2 does not exist yet; the tenant already has a baseline row, so this is a real move.
    const second = await recomputeTenant(client, A, { now: NOW, resolveOwnerEmail: ownerEmail });
    expect(second.alerts).toBe(1);
    const note = tables.record_comments.find((c) => c.object_id === "acc-2");
    expect(note).toMatchObject({ tenant_id: A, object_type: "accounts", mentions: ["owner@example.com"] });
    expect(String(note!.body)).toContain("Quiet Ltd moved from Silent to Comparing");

    // Run again: the stored stage is already Comparing, so no second alert.
    const third = await recomputeTenant(client, A, { now: NOW, resolveOwnerEmail: ownerEmail });
    expect(third.alerts).toBe(0);
    expect(tables.record_comments).toHaveLength(1);
  });

  it("does not alert an owner who is not a member of this tenant", async () => {
    const { client, tables } = fakeDb(baseSeed());
    await recomputeTenant(client, A, { now: NOW, resolveOwnerEmail: ownerEmail });
    tables.accounts.find((a) => a.id === "acc-2")!.owner_user_id = "user-elsewhere";
    tables.quotes.push({ id: "q2", tenant_id: A, ref: "QT-2", account_id: "acc-2", outcome: "open", created_at: daysAgo(1) });
    const r = await recomputeTenant(client, A, { now: NOW, resolveOwnerEmail: ownerEmail });
    expect(r.stageChanges).toBe(1);
    expect(r.alerts).toBe(0);
    expect(tables.record_comments ?? []).toHaveLength(0);
  });

  it("chains the tenant on every query it makes", async () => {
    const { client, queries } = fakeDb(baseSeed());
    await recomputeTenant(client, A, { now: NOW, resolveOwnerEmail: ownerEmail });
    const writes = queries.filter((q) => q.table !== "domain_event" || q.op === "select");
    for (const q of writes) {
      if (q.op === "insert" || q.op === "upsert") continue; // rows carry tenant_id in their body (checked above)
      expect(q.filters.tenant_id, `${q.op} on ${q.table}`).toBe(A);
    }
  });

  it("stops starting work at the deadline and says it was partial", async () => {
    const { client, tables } = fakeDb(baseSeed());
    const r = await recomputeTenant(client, A, { now: NOW, deadline: Date.now() - 1, resolveOwnerEmail: ownerEmail });
    expect(r.partial).toBe(true);
    expect(r.scored).toBe(0);
    expect(tables.account_intent ?? []).toHaveLength(0);
  });

  it("reads missing tables as 'nothing yet' and reports the pending update instead of throwing", async () => {
    const { client } = fakeDb(baseSeed(), { missingTables: ["account_intent", "account_intent_history", "signal_runs"] });
    const r = await recomputeTenant(client, A, { now: NOW, resolveOwnerEmail: ownerEmail });
    expect(r.scored).toBe(0);
    expect(r.error).toContain("not been applied");
  });
});

describe("getBuyingStage", () => {
  const seed = (features: Record<string, unknown>) => ({
    tenants: [{ id: A, features }],
    accounts: [{ id: "acc-1", tenant_id: A }, { id: "acc-b", tenant_id: B }],
    account_intent: [{ tenant_id: A, account_id: "acc-1", stage: "deciding", score: 70, stage_changed_at: "2026-10-18T00:00:00Z", computed_at: "2026-10-20T00:00:00Z" }],
  });

  it("returns the stored stage for the tenant's own account", async () => {
    const { client } = fakeDb(seed({ marketing: true, buying_signals: true }));
    expect(await getBuyingStage(A, "acc-1", client)).toMatchObject({ stage: "deciding", label: "Deciding", score: 70 });
  });
  it("treats an account with no row as Quiet", async () => {
    const s = seed({ marketing: true, buying_signals: true });
    s.accounts.push({ id: "acc-new", tenant_id: A });
    const { client } = fakeDb(s);
    expect(await getBuyingStage(A, "acc-new", client)).toMatchObject({ stage: "quiet", score: 0 });
  });
  it("answers nothing for another tenant's account", async () => {
    const { client } = fakeDb(seed({ marketing: true, buying_signals: true }));
    expect(await getBuyingStage(A, "acc-b", client)).toBeNull();
  });
  it("answers nothing when the module is off", async () => {
    const { client } = fakeDb(seed({ marketing: true }));
    expect(await getBuyingStage(A, "acc-1", client)).toBeNull();
    const off = fakeDb(seed({ buying_signals: true }));
    expect(await getBuyingStage(A, "acc-1", off.client)).toBeNull();
  });
});
