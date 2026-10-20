import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "@/lib/constants";
import { OBJECT_FEATURE, featureForObject } from "@/lib/objectFeatures";
import { FEATURE_DEPENDENCIES, unmetDependencies } from "@/lib/moduleDependencies";
import { moduleEnabled } from "@/lib/marketing/moduleAccess";
import { getProvider, PROVIDERS } from "./provider";
import { whatsappEnabled } from "./identity";

// "Vikas and BIM must see nothing": WhatsApp hangs off a platform-admin flag that is off by default, and everything
// that reaches it asks the same question. These fail the build if a new route, page or public path slips past it,
// or if personal data (a phone number) is ever offered to the API or MCP.

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

describe("WhatsApp is behind its own flag", () => {
  it("the menu item needs whatsapp_marketing and its own workcenter", () => {
    const leaves = NAV.flatMap((g) => g.items.flatMap((i) => i.children ?? [i]));
    const item = leaves.find((l) => l.href === "/marketing/whatsapp");
    expect(item?.featureKey).toBe("whatsapp_marketing");
    expect(item?.workcenterKey).toBe("marketing_whatsapp");
  });

  it("needs BOTH the Marketing module and the platform-admin flag", () => {
    expect(whatsappEnabled({ marketing: true, whatsapp_marketing: true })).toBe(true);
    expect(whatsappEnabled({ marketing: true })).toBe(false);
    expect(whatsappEnabled({ whatsapp_marketing: true })).toBe(false);
    expect(whatsappEnabled(null)).toBe(false);
    const spec = { flag: "whatsapp_marketing" as const };
    expect(moduleEnabled(spec, { marketing: true, whatsapp_marketing: true })).toBe(true);
    expect(moduleEnabled(spec, { marketing: true })).toBe(false);
  });

  it("the objects are owned by the flag, and the flag needs Marketing", () => {
    for (const k of ["whatsapp_templates", "whatsapp_messages", "whatsapp-templates"]) {
      expect(OBJECT_FEATURE[k], k).toBe("whatsapp_marketing");
      expect(featureForObject(k)).toBe("whatsapp_marketing");
    }
    expect(FEATURE_DEPENDENCIES.some((d) => d.key === "whatsapp_marketing" && d.needs === "marketing" && d.strength === "hard")).toBe(true);
    expect(unmetDependencies({ whatsapp_marketing: true }, "whatsapp_marketing")).toHaveLength(1);
    expect(unmetDependencies({ whatsapp_marketing: true, marketing: true }, "whatsapp_marketing")).toHaveLength(0);
  });

  it("every signed-in WhatsApp route resolves the tenant through moduleAccess() before doing anything", () => {
    const routes = walk(join(SRC, "app", "api", "whatsapp")).filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThanOrEqual(5);
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g)?.length ?? 0;
      const gates = src.match(/await moduleAccess\(WHATSAPP_SPEC/g)?.length ?? 0;
      expect(gates, f).toBe(handlers);
      expect(src, f).not.toMatch(/tenant_id\s*[:=]\s*(body|json|searchParams)/);
    }
  });

  it("every WhatsApp page starts with whatsappPage(), which checks the workcenter and both flags", () => {
    const dir = join(SRC, "app", "(app)", "marketing", "whatsapp");
    for (const f of walk(dir).filter((x) => x.endsWith("page.tsx"))) expect(readFileSync(f, "utf8"), f).toMatch(/await whatsappPage\(/);
    const module = read("lib", "marketing", "moduleAccess.ts");
    expect(module).toMatch(/requireWorkcenterView\(spec\.workcenter\)/);
    expect(module).toMatch(/requireFeature\("marketing"\)/);
    expect(module).toMatch(/requireFeature\(spec\.flag\)/);
    expect(read("lib", "marketing", "whatsapp", "server.ts")).toMatch(/flag: "whatsapp_marketing"/);
  });

  it("the send function starts by checking the workspace owns the module, then consent, before anything else", () => {
    const src = read("lib", "marketing", "whatsapp", "send.ts");
    const flag = src.indexOf("whatsappEnabled(t.features)");
    const consent = src.indexOf("await gate(");
    expect(flag).toBeGreaterThan(-1);
    expect(consent).toBeGreaterThan(flag);
    for (const later of ["loadIdentity(", "sendRule(", "capCheck(", "provider.sendTemplate(", "whatsapp_messages\").insert"]) {
      expect(src.indexOf(later), later).toBeGreaterThan(consent);
    }
    expect(src).toMatch(/canContact\(tid, cid, "whatsapp"/);
  });
});

describe("the inbound webhook", () => {
  const proxy = read("proxy.ts");

  it("is one anchored public pattern and nothing broader", () => {
    expect(proxy).toContain(String.raw`/^\/api\/inbound\/whatsapp\/[A-Za-z0-9_-]{16,64}$/.test(pathname)`);
    expect(proxy).not.toMatch(/startsWith\("\/api\/inbound\/whatsapp/);
    expect(proxy).not.toMatch(/startsWith\("\/api\/whatsapp/);
  });

  it("the route never reads a tenant from the request; the handler verifies the signature before it parses the body", () => {
    const route = read("app", "api", "inbound", "whatsapp", "[key]", "route.ts");
    expect(route.replace(/\/\/.*$/gm, "")).not.toMatch(/tenant|searchParams|nextUrl\.search/i);
    const handler = read("lib", "marketing", "whatsapp", "inbound.ts");
    expect(handler.indexOf("verifyWebhook(")).toBeGreaterThan(-1);
    expect(handler.indexOf("verifyWebhook(")).toBeLessThan(handler.indexOf("parseWebhook("));
    expect(handler.indexOf("loadIdentityByKey(")).toBeLessThan(handler.indexOf("verifyWebhook("));
    // the tenant is the identity row's, never a field of the payload
    expect(handler).toMatch(/const tenantId = identity\.tenant_id/);
    expect(handler.replace(/\/\/.*$/gm, "")).not.toMatch(/body\.tenant|payload\.tenant|item\.tenant/);
  });
});

describe("no call leaves the product, and no phone number reaches the API", () => {
  it("only the sandbox is registered, and it never makes a network call", () => {
    expect(Object.keys(PROVIDERS)).toEqual(["sandbox"]);
    expect(getProvider("sandbox")?.live).toBe(false);
    expect(getProvider("meta")).toBeNull();
    expect(getProvider("__proto__")).toBeNull();
    const src = read("lib", "marketing", "whatsapp", "provider.ts").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/\bfetch\(|https?:\/\/|from "(node:)?https?"/);
  });

  it("no v1 endpoint, list source or MCP tool offers WhatsApp data", () => {
    for (const f of walk(join(SRC, "app", "api", "v1"))) expect(readFileSync(f, "utf8").toLowerCase(), f).not.toContain("whatsapp");
    expect(read("lib", "api", "listSources.ts").toLowerCase()).not.toContain("whatsapp");
    const mcp = join(ROOT, "mcp-server", "mcp.json");
    // mcp.json already lists a "send_whatsapp" idea under coming_soon_tools; what must not exist is a read tool.
    if (existsSync(mcp)) expect(readFileSync(mcp, "utf8").toLowerCase()).not.toMatch(/"(list|get)_whatsapp/);
  });

  it("the library has no console.log and writes no phone number to an event", () => {
    for (const f of walk(join(SRC, "lib", "marketing", "whatsapp")).filter((x) => !x.endsWith(".test.ts"))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/console\.log/);
    }
    const send = read("lib", "marketing", "whatsapp", "send.ts");
    const payload = send.slice(send.indexOf("payload: { message_id"), send.indexOf("payload: { message_id") + 140);
    expect(payload).not.toMatch(/phone|body|text/);
  });
});
