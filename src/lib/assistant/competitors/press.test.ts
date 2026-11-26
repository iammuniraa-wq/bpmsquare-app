import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

// The press of the "add a competitor" card. The competitors route is replaced by a stand-in that records what it was given, who it was
// run for and under which "via", so what is held is the door in front of it: the signed card, the checks made again at press time,
// single use, and that nothing the request body says can change the workspace or the tender.

vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests"; });

const { O1, post } = vi.hoisted(() => ({
  O1: "aaaaaaaa-0000-4000-8000-000000000034",
  post: { fn: null as unknown as (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response> },
}));

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => { throw new Error("no database in this test"); },
  requireTenantUser: async () => { throw new Error("not used"); },
  createServerSupabase: async () => { throw new Error("not used"); },
  getAuthUser: async () => null,
}));
vi.mock("@/app/api/opportunities/[id]/competitors/route", () => ({ POST: (req: NextRequest, c: { params: Promise<{ id: string }> }) => post.fn(req, c) }));

import { fakeAdmin, T1, T2 } from "@/lib/middleware/testHarness";
import { currentVia } from "@/lib/actions/via";
import { hashOf, signToken } from "@/lib/actions/token";
import type { PermissionSet } from "@/lib/permissions";
import { pressCompetitorCard, type PressCtx } from "./press";
import { PROPOSE_ACT, actOf, hash8, structureOf } from "./tools";

const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const VIEW_ONLY = { unrestricted: false, grants: new Map([["pipeline", { workcenter: "pipeline", canView: true, canCreate: false, canEdit: false, canDelete: false }]]) } as unknown as PermissionSet;
const ON = { ai_assistant: true, ai_assistant_actions: true, next_experience: true, pipeline: true, gcc_tender: true };
const CARD = "cccccccc-0000-4000-8000-000000000001";

function setup(over: Partial<PressCtx> = {}) {
  const db = fakeAdmin({ opportunities: [{ id: O1, tenant_id: T1, ref: "OPP-0034", title: "Riyadh precast package" }], assistant_actions: [] });
  const ctx: PressCtx = { supabase: db.client as never, admin: db.client as never, tenantId: T1, userId: "user-1", perms: ALL, features: ON, baseUrl: "https://acme.example.com/api/ai/act/competitor", ...over };
  return { db, ctx };
}

const token = (o: { deal?: string; cardId?: string; tenant?: string; user?: string; act?: string; h?: string } = {}) => signToken({
  cid: o.cardId ?? CARD, tid: o.tenant ?? T1, uid: o.user ?? "user-1", act: o.act ?? actOf(o.deal ?? O1), h: o.h ?? structureOf(), dup: hashOf([]),
  sm: "Add Delta Co to the competitors on OPP-0034.", pv: { name: hash8("Delta Co") },
});
const body = (over: Record<string, unknown> = {}) => ({ card_id: CARD, token: token(), values: { name: "Delta Co", country: "UAE", note: "" }, ...over });

let seen: { id: string; body: Record<string, unknown>; via: string | null; url: string }[] = [];

beforeEach(() => {
  seen = [];
  post.fn = async (req, c) => {
    const id = (await c.params).id;
    seen.push({ id, body: await req.json(), via: currentVia(), url: req.url });
    return NextResponse.json({ ok: true, competitor: { id: "comp-1", name: "Delta Co" } }, { status: 201 });
  };
});

describe("a good press", () => {
  it("runs the competitors route for the tender in the token, on the person's session, marked as the assistant's", async () => {
    const { ctx, db } = setup();
    const out = await pressCompetitorCard(ctx, body());
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, record: { id: "comp-1", label: "Delta Co", href: `/pipeline/${O1}?tab=competitors` } });
    expect((out.body.next as { question: string }[])[0].question).toBe("Analyse the competitors on OPP-0034");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: O1, via: "assistant", body: { name: "Delta Co", country: "UAE", notes: null } });
    expect(new URL(seen[0].url).pathname).toBe(`/api/opportunities/${O1}/competitors`);
    expect(db.tables.assistant_actions).toMatchObject([{ id: CARD, tenant_id: T1, user_id: "user-1", status: "done", action_key: PROPOSE_ACT, kind: "create" }]);
  });

  it("is single use: a second press answers 'already done' with the first result and runs nothing", async () => {
    const { ctx } = setup();
    await pressCompetitorCard(ctx, body());
    const again = await pressCompetitorCard(ctx, body());
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ ok: false, code: "already_done", result: { id: "comp-1" } });
    expect(seen).toHaveLength(1);
  });

  it("a press the route refused can be pressed again once fixed", async () => {
    const { ctx, db } = setup();
    post.fn = async () => NextResponse.json({ error: "That competitor is already on the list" }, { status: 409 });
    const first = await pressCompetitorCard(ctx, body());
    expect(first).toMatchObject({ status: 409, body: { ok: false, code: "route_refused", error: "That competitor is already on the list" } });
    expect(db.tables.assistant_actions[0]).toMatchObject({ status: "failed" });
    post.fn = async () => NextResponse.json({ ok: true, competitor: { id: "comp-2", name: "Delta Co" } }, { status: 201 });
    expect((await pressCompetitorCard(ctx, body())).status).toBe(200);
  });
});

describe("the door", () => {
  it.each([
    ["another person's card", { user: "user-2" }],
    ["a card from another workspace", { tenant: T2 }],
    ["a different card id", { cardId: "cccccccc-0000-4000-8000-000000000002" }],
  ])("refuses %s", async (_n, t) => {
    const { ctx } = setup();
    const out = await pressCompetitorCard(ctx, body({ token: token(t) }));
    expect(out).toMatchObject({ status: 403, body: { code: "token" } });
    expect(seen).toEqual([]);
  });

  it("refuses a token that is not a competitor card, and one signed for a structure that is not this one", async () => {
    const { ctx } = setup();
    expect((await pressCompetitorCard(ctx, body({ token: token({ act: "create_account" }) }))).status).toBe(409);
    expect((await pressCompetitorCard(ctx, body({ token: token({ act: `${PROPOSE_ACT}:not-a-uuid` }) }))).status).toBe(409);
    expect((await pressCompetitorCard(ctx, body({ token: token({ h: "other" }) }))).status).toBe(409);
    expect(seen).toEqual([]);
  });

  it("a forged or expired token does nothing", async () => {
    const { ctx } = setup();
    expect((await pressCompetitorCard(ctx, body({ token: "abc.def" }))).status).toBe(403);
    expect((await pressCompetitorCard({ ...ctx, now: Date.now() + 3 * 3_600_000 }, body())).status).toBe(410);
    expect(seen).toEqual([]);
  });

  it("checks the flag, the edition and the edit grant now, not as they were when the card was shown", async () => {
    for (const over of [{ features: { ...ON, ai_assistant_actions: false } }, { features: { ...ON, gcc_tender: false } }, { perms: VIEW_ONLY }]) {
      const out = await pressCompetitorCard(setup(over).ctx, body());
      expect(out).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    }
    expect(seen).toEqual([]);
  });

  it("takes only the three fields the card offered, as plain text", async () => {
    const { ctx } = setup();
    expect((await pressCompetitorCard(ctx, body({ values: { name: "Delta Co", tenant_id: T2 } }))).body).toMatchObject({ code: "unknown_field", fields: ["tenant_id"] });
    expect((await pressCompetitorCard(ctx, body({ values: { name: "Delta Co", opportunity_id: "x" } }))).status).toBe(422);
    expect((await pressCompetitorCard(ctx, body({ values: { name: { a: 1 } } }))).body).toMatchObject({ code: "invalid" });
    expect((await pressCompetitorCard(ctx, body({ values: { name: "   " } }))).body).toMatchObject({ code: "invalid" });
    expect((await pressCompetitorCard(ctx, body({ values: [] }))).status).toBe(400);
    expect((await pressCompetitorCard(ctx, { card_id: CARD, token: token() })).status).toBe(400);
    expect(seen).toEqual([]);
  });

  it("the tender comes from the token alone: a tender of another workspace is not found", async () => {
    const { ctx } = setup();
    const other = "bbbbbbbb-0000-4000-8000-000000000099";
    const out = await pressCompetitorCard(ctx, body({ token: token({ deal: other }) }));
    expect(out).toMatchObject({ status: 422, body: { code: "ref" } });
    expect(seen).toEqual([]);
  });

  it("while the ledger's table is not there yet, nothing runs", async () => {
    const db = fakeAdmin({ opportunities: [{ id: O1, tenant_id: T1, ref: "OPP-0034" }] }, { missing: ["assistant_actions"] });
    const out = await pressCompetitorCard({ ...setup().ctx, admin: db.client as never }, body());
    expect(out).toMatchObject({ status: 503, body: { code: "unavailable" } });
    expect(seen).toEqual([]);
  });

  it("the field values are trimmed and the note is sent as notes", async () => {
    const { ctx } = setup();
    await pressCompetitorCard(ctx, body({ values: { name: "  Delta   Co ", country: " UAE ", note: " strong in precast " } }));
    expect(seen[0].body).toEqual({ name: "Delta Co", country: "UAE", notes: "strong in precast" });
  });
});
