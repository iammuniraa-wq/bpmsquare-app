import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { FEATURE_DEPENDENCIES } from "@/lib/moduleDependencies";

// GCC tender deals, slice 2: the shape of migration 0222, the bundle that carries it, the ledger, the cron, and the hard rule
// of section 10 that the room is INTERNAL ONLY: no guest, no code, no public path, no guest table. Plus the isolation shape of
// every room query (the behaviour is proved in deal-room.routes.test.ts).

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(read("supabase/migrations/0222_deal_room.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const TABLES = ["deal_rooms", "deal_room_members", "deal_room_messages", "deal_room_files"];

function walk(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

describe("migration 0222", () => {
  it("is idempotent", () => {
    for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `create table ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `index ${m[3]}`).toBeTruthy();
    for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
    expect(code).toMatch(/insert into storage\.buckets .* on conflict \(id\) do nothing/);
  });

  it("every table has tenant_id, RLS and a tenant SELECT policy and NOTHING that writes (0199: a member must not post as someone else)", () => {
    for (const t of TABLES) {
      expect(code, t).toMatch(new RegExp(`create table if not exists ${t} \\([^;]*?tenant_id uuid not null references tenants\\(id\\)`));
      expect(code, t).toMatch(new RegExp(`alter table ${t}\\s+enable row level security`));
      const policies = [...code.matchAll(new RegExp(`create policy "([^"]+)" on ${t} for (\\w+)`, "gi"))];
      expect(policies, t).toHaveLength(1);
      expect(policies[0][2].toLowerCase()).toBe("select");
      expect(code, t).toMatch(new RegExp(`on ${t} for select using \\(tenant_id in \\(select tenant_id from tenant_users where user_id = auth\\.uid\\(\\)\\)\\)`));
    }
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("one room per deal, one row per member, the channel is team only, and a question is exactly a message with a status", () => {
    expect(code).toMatch(/unique \(opportunity_id\)/);
    expect(code).toMatch(/unique \(room_id, user_id\)/);
    expect(code).toMatch(/channel text not null default 'team' check \(channel = 'team'\)/);
    expect(code).toMatch(/kind in \('message', 'question', 'decision'\)/);
    expect(code).toMatch(/check \(\(kind = 'question'\) = \(question_status is not null\)\)/);
    expect(code).toMatch(/question_status in \('open', 'answered'\)/);
    expect(code).toMatch(/char_length\(body\) between 1 and 4000/);
    for (const col of ["deleted_at", "deleted_by", "updated_at", "last_seen_at", "last_read_at", "last_digest_at", "mentions uuid\\[\\]"]) expect(code, col).toMatch(new RegExp(col));
  });

  it("the file bucket is private and has no storage policy", () => {
    expect(code).toMatch(/values \('deal-room-files', 'deal-room-files', false, 15728640\)/);
    expect(code).not.toMatch(/on storage\.objects/i);
  });

  it("is internal only: no guest, code, token or invite table or column anywhere", () => {
    expect(code).not.toMatch(/guest|invite|code_hash|revoked|create table if not exists \w*(session|token|code)/i);
    expect(code).not.toMatch(/alter table (if exists )?"?(public"?\.)?opportunities\b/i);
  });

  it("the bundle carries both migrations verbatim, and the ledger lists them as pending", () => {
    const bundle = lf(read("scripts/run-bundle-32-tender-approval-and-room-2026-10-25.sql"));
    expect(bundle).toContain(sql.trim());
    expect(bundle).toContain(lf(read("supabase/migrations/0221_tender_approval_and_bond.sql")).trim());
    expect(bundle.indexOf("create table if not exists approval_requests")).toBeLessThan(bundle.indexOf("create table if not exists deal_rooms"));
    const project = read("PROJECT.md");
    expect(project).toMatch(/0222_deal_room\.sql/);
    expect(project).toMatch(/room-digest/);
  });
});

describe("the room is internal only", () => {
  it("there is no guest route, no guest page and no public path for it", () => {
    expect(existsSync(path.join(ROOT, "src/app/api/room"))).toBe(false);
    expect(existsSync(path.join(ROOT, "src/app/room"))).toBe(false);
    const proxy = read("src/proxy.ts");
    expect(proxy).not.toMatch(/deal-room|\/room\b|room\//);
  });

  it("no file of the room reads a guest token, a code, or signs a link of its own", () => {
    const files = [...walk("src/app/api/deal-rooms"), "src/lib/tender/room.ts", "src/lib/tender/roomServer.ts", "src/lib/tender/roomDigest.ts", "src/components/tender/DealRoom.tsx"]
      .filter((f) => !f.endsWith(".test.ts"));
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/QUOTE_PUBLIC_LINK_SECRET|verify_code|code_hash|guest_?id|guest_?session|guestToken|\/api\/room\//i);
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });

  it("every route goes through the one gate (flags, Pipeline workcenter, a tender deal of this workspace)", () => {
    const routes = walk("src/app/api/deal-rooms").filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThanOrEqual(6);
    for (const f of routes) {
      const src = read(f);
      expect(src, f).toMatch(/openRoomRequest\(/);
      expect(src, f).not.toMatch(/requireTenantUser/);
      expect(src, f).not.toMatch(/body\.(tenant_id|author_id|room_id|channel|created_at|mentions)/);
    }
    const gate = read("src/lib/tender/roomServer.ts");
    for (const flag of ["gcc_tender", "deal_room", "pipeline"]) expect(gate).toContain(`"${flag}"`);
    expect(gate).toMatch(/canViewWorkcenter\(perms, "pipeline"\)/);
    expect(gate).toMatch(/loadOpportunity\(admin, tenantId, opportunityId\)/);
  });

  it("every query on a room table carries the workspace filter", () => {
    const files = ["src/lib/tender/roomServer.ts", "src/lib/tender/roomDigest.ts", ...walk("src/app/api/deal-rooms").filter((f) => f.endsWith("route.ts"))];
    for (const f of files) {
      const src = read(f);
      // Each statement that starts at admin.from("deal_room...") and runs to its terminating semicolon / await must name tenant_id.
      for (const m of src.matchAll(/\.from\("(deal_rooms|deal_room_members|deal_room_messages|deal_room_files)"\)[\s\S]*?(?:;\n|\);\n)/g)) {
        expect(m[0], `${f}: ${m[0].slice(0, 90)}`).toMatch(/tenant_id/);
      }
    }
  });

  it("the room is offered only to workspaces with the flag, and the standard files know nothing of it", () => {
    for (const f of ["src/app/api/opportunities/route.ts", "src/app/(app)/pipeline/new/NewOpportunityForm.tsx", "src/lib/sales/opportunity.ts"]) {
      expect(read(f), f).not.toMatch(/deal_room|deal-room|DealRoom/);
    }
    const page = read("src/app/(app)/pipeline/[id]/page.tsx");
    expect(page).toMatch(/const roomOn = tenant\?\.features\?\.deal_room === true/);
    expect(page).toMatch(/roomOn \? roomSummary\(/);
    expect(read("src/app/(app)/pipeline/[id]/room/page.tsx")).toMatch(/gcc_tender === true && tenant\.features\.deal_room === true\)\) notFound\(\)/);
  });
});

describe("the wiring that applies (3b)", () => {
  it("OBJECT_FEATURE says the room belongs to deal_room, which needs gcc_tender", () => {
    for (const k of ["deal_rooms", "deal_room_members", "deal_room_messages", "deal_room_files"]) expect(featureForObject(k), k).toBe("deal_room");
    expect(FEATURE_DEPENDENCIES).toEqual(expect.arrayContaining([expect.objectContaining({ key: "deal_room", needs: "gcc_tender", strength: "hard" })]));
  });

  it("change history lists the room, behind both flags", () => {
    const src = read("src/app/(app)/administration/change-history/ChangeHistoryClient.tsx");
    expect(src).toMatch(/value: "deal_rooms"/);
    expect(src).toMatch(/useTenantFeature\("deal_room"\)/);
  });

  it("the digest is a 15-minute cron that the session gate lets through", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons.find((c) => c.path === "/api/tenders/cron/room-digest")?.schedule).toBe("*/15 * * * *");
    expect(read("src/app/api/tenders/cron/room-digest/route.ts")).toMatch(/cronSecretOk\(/);
    expect(read("src/proxy.ts")).toMatch(/startsWith\("\/api\/tenders\/cron\/"\)/);
  });

  it("the mail goes through resolveOutbound and the email log, the inbox note through the existing mention mechanism", () => {
    const notify = read("src/lib/tender/notify.ts");
    expect(notify).toMatch(/resolveOutbound\(/);
    expect(notify).toMatch(/logEmail\(/);
    expect(read("src/lib/tender/roomDigest.ts")).toMatch(/sendTenderMail\(/);
    expect(read("src/lib/tender/roomServer.ts")).toMatch(/inboxNote\(/);
  });

  it("the capability document describes the internal room", () => {
    const doc = read("docs/capabilities/deal_room.md");
    expect(doc).toMatch(/Only people in your workspace/);
    expect(doc).not.toMatch(/separate channel|client channel|invite/i);
  });

  it("the screens carry data-guide ids the assistant can point at", () => {
    const src = read("src/components/tender/DealRoom.tsx") + read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    const ids = new Set([...src.matchAll(/"(room\.[a-z_.]+)"/g)].map((m) => m[1]));
    for (const id of ["room.tab", "room.subtabs", "room.discussion", "room.composer", "room.send", "room.attach", "room.mention", "room.members", "room.add_member", "room.decisions", "room.decision_input", "room.files", "room.reply", "room.remove", "room.open_full"]) {
      expect(ids, id).toContain(id);
    }
  });
});
