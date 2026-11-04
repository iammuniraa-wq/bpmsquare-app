import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { AGENTS, COMING_SOON, availableAgents, agentEntry, isAgentKey } from "./registry";
import { ROUTES, NAV } from "@/lib/constants";
import { WORKCENTERS } from "@/lib/workcenters";
import { buildNavGroups } from "@/lib/navGroups";
import { canSeeFinding, canSeeRuns } from "./core/visibility";
import { digestMessage } from "./server/digest";
import { rotate } from "./server/work";
import { agoLabel } from "@/components/crew/When";
import { EVENTS, isKnownEvent } from "@/lib/events/catalog";
import { TENDER_TOOL_SPECS } from "./adapters/tenderSpecs";

// Wiring checks for AI automation (bpmsquarecore 3b): the registry, the flags, the nav, the adapters rule, the RLS stance, the cron secrets, and the
// pure helpers the screens use. None of it needs a model or a database.

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function featureKeys(): Set<string> {
  const src = read("src/lib/constants.ts");
  const body = src.slice(src.indexOf("export type TenantFeatures = {"));
  return new Set([...body.slice(0, body.indexOf("\n};")).matchAll(/^\s{2}(\w+): boolean;/gm)].map((m) => m[1]));
}

describe("the agent registry drives the gallery and the runner", () => {
  it("every agent names real flags, a route and a logo, and the keys are unique", () => {
    const keys = featureKeys();
    expect(new Set(AGENTS.map((a) => a.key)).size).toBe(AGENTS.length);
    for (const a of AGENTS) {
      expect(keys.has(a.flag), a.key).toBe(true);
      for (const r of a.requires) expect(keys.has(r), `${a.key} requires ${r}`).toBe(true);
      expect(a.href).toBe(ROUTES.aiAutomationAgent(a.key));
      expect(a.defaults.monthlyTokenCap).toBeGreaterThan(0);
    }
    expect(agentEntry("tender_watch")!.defaults.monthlyTokenCap).toBe(600_000);
    expect(agentEntry("attendance")!.defaults.monthlyTokenCap).toBe(500_000);
    expect(agentEntry("attendance")!.defaults.retentionDays).toBe(90);
    expect(agentEntry("tender_watch")!.defaults.retentionDays).toBe(180);
    expect(isAgentKey("tender_watch")).toBe(true);
    expect(isAgentKey("nope")).toBe(false);
  });

  it("the three flags exist, are platform-admin flags and default OFF in the new-tenant form", () => {
    const keys = featureKeys();
    for (const k of ["crew", "crew_tender_watch", "crew_attendance"]) {
      expect(keys.has(k)).toBe(true);
      expect(read("src/app/admin/tenants/new/NewTenantForm.tsx")).toMatch(new RegExp(`${k}: false`));
      expect(read("src/app/admin/tenants/[id]/TenantEditor.tsx")).toContain(`key: "${k}"`);
    }
  });

  it("an agent appears only when crew, its own flag and its module flags are on", () => {
    expect(availableAgents({})).toEqual([]);
    expect(availableAgents({ crew_tender_watch: true, gcc_tender: true, pipeline: true })).toEqual([]);
    expect(availableAgents({ crew: true, crew_tender_watch: true })).toEqual([]);
    expect(availableAgents({ crew: true, crew_tender_watch: true, gcc_tender: true, pipeline: true }).map((a) => a.key)).toEqual(["tender_watch"]);
    expect(availableAgents({ crew: true, crew_attendance: true, wfm: true }).map((a) => a.key)).toEqual(["attendance"]);
    expect(availableAgents({ crew: true, crew_attendance: true, crew_tender_watch: true, wfm: true, gcc_tender: true, pipeline: true }).map((a) => a.key)).toEqual(["tender_watch", "attendance"]);
  });

  it("the roadmap tiles are the four planned agents, as data with no route", () => {
    expect(COMING_SOON.map((c) => c.name)).toEqual(["Quote Follow-up", "Invoice Chaser", "Lead Nurture", "Contract Renewal"]);
    for (const c of COMING_SOON) expect("href" in c).toBe(false);
  });

  it("Attendance is registered but its engine is pending until the lead wires it", () => {
    expect(agentEntry("attendance")!.engine).toBe("pending");
    expect(agentEntry("tender_watch")!.engine).toBe("ready");
  });
});

describe("the workcenter", () => {
  it("is a nav group of its own, gated on the crew flag and a Business Role workcenter", () => {
    const group = NAV.find((g) => g.group === "AI AUTOMATION")!;
    expect(group.items).toHaveLength(1);
    expect(group.items[0]).toMatchObject({ href: ROUTES.aiAutomation, featureKey: "crew", workcenterKey: "crew" });
    expect(WORKCENTERS.some((w) => w.key === "crew" && w.label === "AI automation")).toBe(true);
  });
  it("is invisible without the flag and with a Business Role that does not grant it", () => {
    const labels = (features: Record<string, boolean>, viewable: "all" | string[]) => buildNavGroups(features, viewable as never, false).flatMap((g) => g.items.map((i) => i.label));
    expect(labels({}, "all")).not.toContain("AI automation");
    expect(labels({ crew: true }, "all")).toContain("AI automation");
    expect(labels({ crew: true }, ["accounts"])).not.toContain("AI automation");
    expect(labels({ crew: true }, ["crew"])).toContain("AI automation");
  });
});

describe("tool adapters (design 3.4)", () => {
  const dir = path.join(root, "src/lib/crew/adapters");
  it("reach no table directly: only existing tenant-scoped readers", () => {
    for (const f of readdirSync(dir).filter((x) => /\.tsx?$/.test(x))) expect(strip(readFileSync(path.join(dir, f), "utf8")), f).not.toMatch(/\.from\s*\(/);
  });
  it("none takes the tenant as an argument", () => {
    for (const f of readdirSync(dir).filter((x) => /\.tsx?$/.test(x))) expect(strip(readFileSync(path.join(dir, f), "utf8")), f).not.toMatch(/args\.(tenant|tenant_id|tenantId)/);
  });
  it("every spec key is allow-listed by the tender definition and nothing else is", () => {
    const def = read("src/lib/crew/tender/definition.ts");
    for (const k of Object.keys(TENDER_TOOL_SPECS)) expect(def).toContain(`"${k}"`);
  });
  it("the model has no write-shaped tool: the only submit is submit_findings", () => {
    expect(Object.keys(TENDER_TOOL_SPECS).every((k) => /^(tender)_/.test(k))).toBe(true);
    expect(read("src/lib/crew/core/loop.ts")).toContain('SUBMIT_TOOL = "submit_findings"');
  });
});

describe("the approval gate and autonomy", () => {
  it("every definition proposes only; the closed action registry has the two actions of the design", () => {
    const def = read("src/lib/crew/tender/definition.ts");
    expect(def).toContain('autonomy: "propose"');
    const types = read("src/lib/crew/types.ts");
    expect(types).toContain('export type Autonomy = "propose";');
    expect(types).toContain('export type ActionKey = "tender.nudge" | "wfm.recheck";');
    const gate = read("src/lib/crew/server/gate.ts");
    expect(gate).toMatch(/EXECUTORS: Partial<Record<ActionKey, Executor>> = \{\s*"tender\.nudge": executeNudge,\s*\}/);
  });
  it("the press is claimed by compare-and-set and runs inside runVia('crew')", () => {
    const gate = read("src/lib/crew/server/gate.ts");
    expect(gate).toMatch(/\.eq\("status", "pending"\)\.gt\("expires_at"/);
    expect(gate).toContain('runVia("crew"');
    expect(read("src/lib/actions/via.ts")).toContain('"assistant" | "crew"');
  });
  it("nothing in the run loop or the adapters can send: no mailer, no room post", () => {
    for (const f of ["src/lib/crew/core/loop.ts", "src/lib/crew/core/tools.ts", "src/lib/crew/adapters/tender.ts", "src/lib/crew/server/runner.ts"]) {
      expect(strip(read(f)), f).not.toMatch(/sendTenderMail|postMessage|resolveOutbound|\.send\(/);
    }
  });
});

describe("crons and routes", () => {
  it("the three crons are registered, each checks the cron secret and exports its own maxDuration", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    for (const [p, sched] of [["/api/crew/cron/plan", "*/15 * * * *"], ["/api/crew/cron/work", "*/5 * * * *"], ["/api/crew/cron/retention", "45 20 * * *"]]) {
      expect(vercel.crons.find((c) => c.path === p)?.schedule, p).toBe(sched);
      const src = read(`src${p.replace("/api", "/app/api")}/route.ts`);
      expect(src).toContain("cronSecretOk");
      expect(src).toMatch(/export const maxDuration = \d+/);
    }
  });
  it("no crew route takes a tenant id from the request (the workspace comes from the host), except the platform-admin one", () => {
    const walk = (dir: string, out: string[] = []): string[] => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/route\.ts$/.test(e.name)) out.push(p); } return out; };
    for (const f of walk(path.join(root, "src/app/api/crew"))) {
      const src = strip(readFileSync(f, "utf8"));
      if (f.includes(`${path.sep}cron${path.sep}`)) continue;
      expect(src, f).toContain("openCrew");
      expect(src, f).not.toMatch(/body\??\.(tenant|tenant_id|tenantId)|searchParams\.get\("tenant/);
    }
    expect(read("src/app/api/admin/crew/[tenantId]/route.ts")).toContain("isPlatformAdmin");
  });
  it("the two new events are catalogued and emitted", () => {
    expect(isKnownEvent(EVENTS.TENDER_DECISION_PROPOSED)).toBe(true);
    expect(isKnownEvent(EVENTS.TENDER_DETAILS_CHANGED)).toBe(true);
    expect(read("src/app/api/opportunities/[id]/tender/approval/route.ts")).toContain("emitTenderDecisionProposed");
    expect(read("src/app/api/opportunities/[id]/tender/route.ts")).toContain("emitTenderDetailsChanged");
  });
});

describe("the migrations (bpmsquarecore 3b, the 0062 / 0199 lessons)", () => {
  const sql = (f: string) => read(`supabase/migrations/${f}`).replace(/--[^\n]*/g, "");
  const f1 = sql("0245_crew_foundation.sql");
  const f2 = sql("0246_crew_event_cursor.sql");
  it("every table has tenant_id, RLS in the same file, and is idempotent", () => {
    for (const t of ["crew_agent_settings", "crew_runs", "crew_steps", "crew_findings", "crew_proposals"]) {
      expect(f1, t).toMatch(new RegExp(`create table if not exists ${t} \\([^;]*tenant_id\\s+uuid not null references tenants\\(id\\)`));
      expect(f1, t).toMatch(new RegExp(`alter table ${t}\\s+enable row level security`));
    }
    expect(f2).toMatch(/alter table crew_cursors enable row level security/);
    expect(f2).toMatch(/tenant_id\s+uuid primary key references tenants\(id\)/);
  });
  it("only crew_agent_settings has a policy, and it is member SELECT only: no member can write anything", () => {
    const policies = [...f1.matchAll(/create policy "([^"]+)" on (\w+) for (\w+)/g)];
    expect(policies.map((m) => [m[2], m[3]])).toEqual([["crew_agent_settings", "select"]]);
    expect(/create\s+policy/i.test(f2)).toBe(false);
    expect(f1).not.toMatch(/for (all|insert|update|delete)/);
  });
  it("the unique indexes that make runs, findings and proposals idempotent are there", () => {
    expect(f1).toMatch(/unique \(tenant_id, dedupe_key\)/);
    expect(f1).toMatch(/crew_findings_open_fp_uniq on crew_findings \(tenant_id, fingerprint\) where status in \('open', 'seen'\)/);
    expect(f1).toMatch(/crew_proposals_pending_fp_uniq on crew_proposals \(tenant_id, fingerprint\) where status = 'pending'/);
  });
  it("the bundle carries both migrations verbatim and in order, and the demo seed says it runs after them and touches only demo workspaces", () => {
    const norm = (x: string) => x.split("\r\n").join("\n").trim();
    const bundle = norm(read("scripts/run-bundle-crew-0245-0246-2026-11-04.sql"));
    const a = norm(read("supabase/migrations/0245_crew_foundation.sql"));
    const b = norm(read("supabase/migrations/0246_crew_event_cursor.sql"));
    expect(bundle).toContain(a);
    expect(bundle).toContain(b);
    expect(bundle.indexOf(a)).toBeLessThan(bundle.indexOf(b));
    const seed = read("scripts/seed-crew-demo.sql");
    expect(seed).toMatch(/Run AFTER supabase\/migrations\/0245_crew_foundation\.sql/);
    expect(seed).toMatch(/where is_demo = true/);
    expect(seed).not.toMatch(/update tenants[^;]*where (?!id = t\.id)/);
  });

  it("no member write path exists in application code for these tables (service role only)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { walk(p); continue; } if (!/\.(ts|tsx)$/.test(e.name) || /\.test\./.test(e.name)) continue; if (/\bsupabase\s*\.from\(\s*"crew_/.test(readFileSync(p, "utf8"))) offenders.push(path.relative(root, p)); } };
    walk(path.join(root, "src"));
    expect(offenders).toEqual([]);
  }, 60_000);
});

describe("who sees what", () => {
    const f = (agent: "tender_watch" | "attendance", recipients: string[]) => ({ agent_key: agent, recipient_ids: recipients });
  it("a workspace admin sees every finding; a member only what was addressed to them and only once the agent is widened", () => {
    expect(canSeeFinding({ role: "admin", userId: "a", pipeline: true }, f("tender_watch", []), "admins")).toBe(true);
    expect(canSeeFinding({ role: "member", userId: "u", pipeline: true }, f("tender_watch", ["u"]), "admins")).toBe(false);
    expect(canSeeFinding({ role: "member", userId: "u", pipeline: true }, f("tender_watch", ["u"]), undefined)).toBe(false);
    expect(canSeeFinding({ role: "member", userId: "u", pipeline: true }, f("tender_watch", ["u"]), "deal_teams")).toBe(true);
    expect(canSeeFinding({ role: "member", userId: "u", pipeline: true }, f("tender_watch", ["x"]), "deal_teams")).toBe(false);
  });
  it("attendance findings are admin-only until the supervisor slice defines site scope", () => {
    expect(canSeeFinding({ role: "member", userId: "u", pipeline: true }, f("attendance", ["u"]), "deal_teams")).toBe(false);
    expect(canSeeFinding({ role: "admin", userId: "a", pipeline: true }, f("attendance", []), "admins")).toBe(true);
  });
  it("runs and traces follow the same shadow rule", () => {
    expect(canSeeRuns({ role: "admin" }, "admins")).toBe(true);
    expect(canSeeRuns({ role: "member" }, "admins")).toBe(false);
    expect(canSeeRuns({ role: "member" }, "deal_teams")).toBe(true);
  });
});

describe("small pure helpers", () => {
  it("rotates queued runs across workspaces so one cannot starve another", () => {
    const rows = [{ tenant_id: "a", n: 1 }, { tenant_id: "a", n: 2 }, { tenant_id: "a", n: 3 }, { tenant_id: "b", n: 4 }, { tenant_id: "c", n: 5 }];
    expect(rotate(rows).map((r) => r.n)).toEqual([1, 4, 5, 2, 3]);
  });
  it("words the opt-in digest in Review suggestion terms and caps the list", () => {
    const m = digestMessage("Tender Watch", Array.from({ length: 10 }, (_, i) => ({ title: `Finding ${i}`, severity: i === 0 ? ("urgent" as const) : ("review" as const) })), "https://x.example/ai-automation/tender_watch");
    expect(m.subject).toBe("Tender Watch: 10 suggestions to review");
    expect(m.text).toContain("Review soon: Finding 0");
    expect(m.text).toContain("and 2 more");
    expect(m.text).toContain("You are getting this because you turned the digest on.");
  });
  it("reads a time as ago", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    expect(agoLabel("2026-11-04T11:58:00Z", now)).toBe("2 min ago");
    expect(agoLabel("2026-11-04T09:00:00Z", now)).toBe("3 h ago");
    expect(agoLabel("2026-11-02T12:00:00Z", now)).toBe("2 days ago");
    expect(agoLabel("2026-11-04T12:00:00Z", now)).toBe("just now");
  });
});
