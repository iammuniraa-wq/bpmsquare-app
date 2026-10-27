import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  events: [] as Row[],
  inserted: [] as Row[],
}));

const EMP = "11111111-1111-1111-1111-111111111111";
const DEVICE = "dev-1";

function events() {
  const filters: [string, unknown][] = [];
  let desc = true;
  let nullSuperseded = false;
  const b: Record<string, unknown> = {};
  const rows = () =>
    state.events
      .filter((r) => filters.every(([k, v]) => r[k] === v) && (!nullSuperseded || (r.superseded_by ?? null) === null))
      .sort((a, c) => (desc ? -1 : 1) * String(a.ts).localeCompare(String(c.ts)));
  Object.assign(b, {
    select: () => b,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    is: () => { nullSuperseded = true; return b; },
    order: (_c: string, o: { ascending: boolean }) => { desc = !o.ascending; return b; },
    limit: () => b,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    insert: async (row: Row) => { state.inserted.push(row); state.events.push(row); return { error: null }; },
  });
  return b;
}

function simple(row: Row | null) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, { select: chain, eq: chain, maybeSingle: async () => ({ data: row, error: null }) });
  return b;
}

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: (name: string) =>
      name === "wfm_presence_events" ? events()
      : name === "employees" ? simple({ id: EMP, first_name: "Asha", last_name: "Rao", status: "active", shift_id: null })
      : simple(null),
  }),
}));
vi.mock("@/lib/wfm/server", () => ({ getWfmConfig: async () => ({ face_punch: "on", timezone: "UTC" }) }));
vi.mock("@/lib/wfm/projectServer", () => ({ resolveProjectForPunch: async () => null }));
vi.mock("@/lib/wfm/kiosk", async () => {
  const actual = await vi.importActual<typeof import("@/lib/wfm/kiosk")>("@/lib/wfm/kiosk");
  return { ...actual, authenticateKiosk: async () => ({ id: DEVICE, tenant_id: "t1", site_id: "s1", name: "Door" }) };
});

import { POST } from "./route";
import { signMatchTicket } from "@/lib/wfm/kiosk";

const NOW = new Date("2026-10-23T09:00:00Z");

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.events = [];
  state.inserted = [];
});

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ev = (kind: string, ts: string, extra: Row = {}): Row => ({ id: `e-${kind}-${ts}`, tenant_id: "t1", employee_id: EMP, kind, ts, superseded_by: null, ...extra });

async function punch(kind: string, confidence?: number) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("ticket", signMatchTicket(EMP, DEVICE, confidence));
  const res = await POST(new Request("http://x/api/wfm/kiosk/punch", { method: "POST", body: form }) as never);
  return { res, body: await res.json() };
}

describe("kiosk punch: match confidence", () => {
  it("stamps the signed match confidence into flags beside the device id", async () => {
    const { res } = await punch("check_in", 97.31);
    expect(res.status).toBe(200);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].flags).toEqual({ kiosk_device_id: DEVICE, match_confidence: 97.31 });
  });

  it("a ticket without a confidence (minted before this change) still punches, with no confidence flag", async () => {
    const { res } = await punch("check_in");
    expect(res.status).toBe(200);
    expect(state.inserted[0].flags).toEqual({ kiosk_device_id: DEVICE });
  });

  it("rejects a ticket whose confidence was edited", async () => {
    const ticket = signMatchTicket(EMP, DEVICE, 80);
    const parts = ticket.split(".");
    parts[2] = "9999";
    const form = new FormData();
    form.set("kind", "check_in");
    form.set("ticket", parts.join("."));
    const res = await POST(new Request("http://x/api/wfm/kiosk/punch", { method: "POST", body: form }) as never);
    expect(res.status).toBe(401);
    expect(state.inserted).toHaveLength(0);
  });
});

describe("kiosk punch: duplicate guard", () => {
  it("a second punch of the same kind inside 20 seconds returns the first, as a 200", async () => {
    const first = await punch("check_in", 95);
    expect(first.res.status).toBe(200);
    const firstTs = first.body.ts;

    vi.setSystemTime(new Date(NOW.getTime() + 5_000));
    const second = await punch("check_in", 95);
    expect(second.res.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.ts).toBe(firstTs);
    expect(state.inserted).toHaveLength(1);
  });

  it("outside the window the same kind is a new punch (previous shift day, so the state machine allows it)", async () => {
    state.events = [ev("check_in", ago(2 * 24 * 3600_000))];
    const { res } = await punch("check_in");
    expect(res.status).toBe(200);
    expect(state.inserted).toHaveLength(1);
  });

  it("just past 20 seconds is no longer a duplicate and the state machine answers", async () => {
    state.events = [ev("check_in", ago(21_000))];
    const { res } = await punch("check_in");
    expect(res.status).toBe(409);
    expect(state.inserted).toHaveLength(0);
  });

  it("a different kind within the window is a new punch", async () => {
    state.events = [ev("check_in", ago(5_000))];
    const { res, body } = await punch("check_out");
    expect(res.status).toBe(200);
    expect(body.duplicate).toBeUndefined();
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].kind).toBe("check_out");
  });

  it("a real sequence (break_start, break_end, break_start) is never mistaken for a repeat", async () => {
    state.events = [ev("check_in", ago(60_000)), ev("break_start", ago(10_000)), ev("break_end", ago(4_000))];
    const { res, body } = await punch("break_start");
    expect(res.status).toBe(200);
    expect(body.duplicate).toBeUndefined();
    expect(state.inserted).toHaveLength(1);
  });

  it("only this tenant's events count: another workspace's recent punch for the same id is ignored", async () => {
    state.events = [ev("check_in", ago(3_000), { tenant_id: "t2" })];
    const { res, body } = await punch("check_in");
    expect(res.status).toBe(200);
    expect(body.duplicate).toBeUndefined();
    expect(state.inserted).toHaveLength(1);
  });

  it("keeps the 409 for a genuinely illegal sequence", async () => {
    state.events = [ev("check_in", ago(3600_000))];
    const { res } = await punch("check_in");
    expect(res.status).toBe(409);
  });
});

afterEach(() => { vi.useRealTimers(); });
