import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "@/lib/constants";
import { OBJECT_FEATURE, featureForObject } from "@/lib/objectFeatures";
import { FEATURE_DEPENDENCIES, unmetDependencies } from "@/lib/moduleDependencies";
import { moduleEnabled } from "@/lib/marketing/moduleAccess";

// "Vikas and BIM must see nothing": Events hang off a platform-admin flag that is off by default, and everything
// that reaches them asks the same question.

const SRC = join(__dirname, "..", "..", "..");
const ROOT = join(SRC, "..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css|json)$/.test(name)) out.push(p);
  }
  return out;
};
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Events are behind their own flag", () => {
  it("the menu item needs marketing_events and its own workcenter", () => {
    const leaves = NAV.flatMap((g) => g.items.flatMap((i) => i.children ?? [i]));
    const item = leaves.find((l) => l.href === "/marketing/events");
    expect(item?.featureKey).toBe("marketing_events");
    expect(item?.workcenterKey).toBe("marketing_events");
  });

  it("needs Marketing, Forms and the platform-admin flag", () => {
    const spec = { flag: "marketing_events" as const, also: ["marketing_forms" as const] };
    expect(moduleEnabled(spec, { marketing: true, marketing_forms: true, marketing_events: true })).toBe(true);
    expect(moduleEnabled(spec, { marketing: true, marketing_events: true })).toBe(false);
    expect(moduleEnabled(spec, { marketing: true, marketing_forms: true })).toBe(false);
    expect(moduleEnabled(spec, { marketing_forms: true, marketing_events: true })).toBe(false);
    expect(moduleEnabled(spec, null)).toBe(false);
  });

  it("the objects are owned by the flag, and the flag needs Marketing and Forms", () => {
    for (const k of ["marketing_events", "event_registrations"]) {
      expect(OBJECT_FEATURE[k], k).toBe("marketing_events");
      expect(featureForObject(k)).toBe("marketing_events");
    }
    const needs = FEATURE_DEPENDENCIES.filter((d) => d.key === "marketing_events" && d.strength === "hard").map((d) => d.needs).sort();
    expect(needs).toEqual(["marketing", "marketing_forms"]);
    expect(unmetDependencies({ marketing_events: true }, "marketing_events").map((u) => u.needs)).toEqual(expect.arrayContaining(["marketing", "marketing_forms"]));
  });

  it("every signed-in events route resolves the tenant through moduleAccess() before doing anything", () => {
    const routes = walk(join(SRC, "app", "api", "marketing-events")).filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThanOrEqual(6);
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g)?.length ?? 0;
      const gates = src.match(/await moduleAccess\(EVENTS_SPEC/g)?.length ?? 0;
      expect(gates, f).toBe(handlers);
      expect(code(src), f).not.toMatch(/tenant_id\s*[:=]\s*(body|json|searchParams)/);
    }
  });

  it("every events page starts with eventsPage(), which checks the workcenter and every flag", () => {
    const dir = join(SRC, "app", "(app)", "marketing", "events");
    for (const f of walk(dir).filter((x) => x.endsWith("page.tsx"))) expect(readFileSync(f, "utf8"), f).toMatch(/await eventsPage\(/);
    expect(read("lib", "marketing", "events", "server.ts")).toMatch(/also: \["marketing_forms"\]/);
  });
});

describe("the form hook and the follow-up", () => {
  it("the form submit registers people only for a workspace with the module, after the answers are kept, and never throws into the visitor's request", () => {
    const submit = code(read("lib", "marketing", "forms", "submit.ts"));
    const hook = submit.indexOf("eventsEnabled(tenant.features)");
    expect(hook).toBeGreaterThan(submit.indexOf("EVENTS.FORM_SUBMITTED"));
    expect(hook).toBeLessThan(submit.indexOf("purgeExpired(admin, tenantId)"));
    const reg = code(read("lib", "marketing", "events", "register.ts"));
    const fn = reg.slice(reg.indexOf("export async function registerFromSubmission"));
    expect(fn).toMatch(/try \{[\s\S]*\} catch/);
    expect(fn).toMatch(/\.eq\("tenant_id", tenantId\)/);
  });

  it("the follow-up starts a journey through the runner's enrolment and sends nothing itself", () => {
    const src = code(read("lib", "marketing", "events", "server.ts"));
    expect(src).toContain("enrolFromEvent(");
    expect(src).not.toMatch(/sendNewsletter|sendWhatsApp|resend|emailOutput/i);
    expect(src).toMatch(/journey\.status !== "live"/);
  });

  it("no v1 endpoint, list source or MCP tool offers events or registrations", () => {
    for (const f of walk(join(SRC, "app", "api", "v1"))) expect(readFileSync(f, "utf8").toLowerCase(), f).not.toMatch(/event_registrations|marketing_events/);
    expect(read("lib", "api", "listSources.ts").toLowerCase()).not.toMatch(/event_registrations|marketing_events/);
    const mcp = join(ROOT, "mcp-server", "mcp.json");
    if (existsSync(mcp)) expect(readFileSync(mcp, "utf8").toLowerCase()).not.toMatch(/event_registrations|marketing_events/);
  });

  it("the attendee list never selects a phone number or an email", () => {
    const src = code(read("lib", "marketing", "events", "server.ts"));
    const list = src.slice(src.indexOf("export async function listAttendees"), src.indexOf("export async function loadResults"));
    expect(list).not.toMatch(/from\("(contacts|accounts)"\)\.select\("[^"]*(phone|email)/i);
    expect(list).toMatch(/from\("contacts"\)\.select\("id, name"\)/);
  });
});
