import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { emitEvent, eventDedupeKey, buildEventRow } from "./emit";
import { EVENTS, isKnownEvent } from "./catalog";

type Call = { table: string; row: Record<string, unknown>; opts: Record<string, unknown> };

function fakeClient(result: { error: { code?: string; message: string } | null } | "throw") {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>, opts: Record<string, unknown>) {
          if (result === "throw") throw new Error("network down");
          calls.push({ table, row, opts });
          return Promise.resolve(result);
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("event catalogue", () => {
  it("adopts the Sales Engine and Newsletter Studio names verbatim", () => {
    for (const n of ["opportunity.stage_changed", "quote.sent", "quote.outcome_changed", "email.clicked", "email.interest", "email.unsubscribed", "newsletter.version_created", "invoice.overdue", "case.closed", "campaign.sent"]) {
      expect(isKnownEvent(n)).toBe(true);
    }
    expect(isKnownEvent("made.up")).toBe(false);
  });

  it("has no duplicate names", () => {
    const names = Object.values(EVENTS);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("emitEvent", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { errSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => errSpy.mockRestore());

  it("writes a tenant-scoped row through an idempotent upsert on the natural key", async () => {
    const { client, calls } = fakeClient({ error: null });
    const ok = await emitEvent("t-1", { name: EVENTS.CASE_CREATED, object_type: "case", object_id: "c-1", key: "c-1:created", payload: { ref: "CAS-1" } }, client);
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("domain_event");
    expect(calls[0].row.tenant_id).toBe("t-1");
    expect(calls[0].row.dedupe_key).toBe("case.created|case|c-1|c-1:created");
    expect(calls[0].opts).toEqual({ onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true });
  });

  it("a retry produces the identical natural key, so it cannot double-emit", async () => {
    const ev = { name: EVENTS.OPPORTUNITY_STAGE_CHANGED, object_type: "opportunity", object_id: "o-1", key: "o-1:lead->won" } as const;
    const a = fakeClient({ error: null });
    const b = fakeClient({ error: null });
    await emitEvent("t-1", ev, a.client);
    await emitEvent("t-1", ev, b.client);
    expect(a.calls[0].row.dedupe_key).toBe(b.calls[0].row.dedupe_key);
  });

  it("without a key, falls back to the minute the event occurred in", () => {
    const base = { name: EVENTS.INVOICE_PAID, object_type: "invoice", object_id: "i-1" } as const;
    expect(eventDedupeKey({ ...base, occurred_at: "2026-10-19T10:15:05.000Z" })).toBe(eventDedupeKey({ ...base, occurred_at: "2026-10-19T10:15:55.000Z" }));
    expect(eventDedupeKey({ ...base, occurred_at: "2026-10-19T10:15:05.000Z" })).not.toBe(eventDedupeKey({ ...base, occurred_at: "2026-10-19T10:16:05.000Z" }));
  });

  it("swallows a missing table silently (migration pending)", async () => {
    const { client } = fakeClient({ error: { code: "42P01", message: 'relation "domain_event" does not exist' } });
    await expect(emitEvent("t-1", { name: EVENTS.CASE_CLOSED, object_type: "case", object_id: "c-1" }, client)).resolves.toBe(false);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("swallows PGRST205 (table not in the schema cache) too", async () => {
    const { client } = fakeClient({ error: { code: "PGRST205", message: "Could not find the table 'public.domain_event' in the schema cache" } });
    await expect(emitEvent("t-1", { name: EVENTS.CASE_CLOSED, object_type: "case", object_id: "c-1" }, client)).resolves.toBe(false);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("swallows other database errors, logging with console.error only", async () => {
    const { client } = fakeClient({ error: { code: "XX000", message: "boom" } });
    await expect(emitEvent("t-1", { name: EVENTS.CASE_CLOSED, object_type: "case", object_id: "c-1" }, client)).resolves.toBe(false);
    expect(errSpy).toHaveBeenCalledOnce();
  });

  it("never throws, even if the client throws", async () => {
    const { client } = fakeClient("throw");
    await expect(emitEvent("t-1", { name: EVENTS.CASE_CLOSED, object_type: "case", object_id: "c-1" }, client)).resolves.toBe(false);
  });

  it("refuses a name that is not in the catalogue and writes nothing", async () => {
    const { client, calls } = fakeClient({ error: null });
    const ok = await emitEvent("t-1", { name: "made.up" as never, object_type: "x" }, client);
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuses to write without a tenant", async () => {
    const { client, calls } = fakeClient({ error: null });
    expect(await emitEvent("", { name: EVENTS.CASE_CLOSED, object_type: "case" }, client)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("buildEventRow", () => {
  it("takes the tenant from the argument, never from the payload", () => {
    const row = buildEventRow("t-1", { name: EVENTS.CASE_CREATED, object_type: "case", payload: { tenant_id: "t-evil" } });
    expect(row.tenant_id).toBe("t-1");
  });

  it("defaults source to app, depth to 0, and rejects an unknown source", () => {
    const row = buildEventRow("t-1", { name: EVENTS.CASE_CREATED, object_type: "case", source: "bogus" as never });
    expect(row.source).toBe("app");
    expect(row.depth).toBe(0);
  });

  it("replaces an oversized payload instead of storing it", () => {
    const row = buildEventRow("t-1", { name: EVENTS.CASE_CREATED, object_type: "case", payload: { blob: "x".repeat(20_000) } });
    expect(row.payload).toEqual({ truncated: true });
  });
});
