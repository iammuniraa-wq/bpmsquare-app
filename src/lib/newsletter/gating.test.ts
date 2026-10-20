import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "@/lib/constants";
import { OBJECT_FEATURE, featureForObject } from "@/lib/objectFeatures";
import { FEATURE_DEPENDENCIES, unmetDependencies } from "@/lib/moduleDependencies";
import { SETTINGS_MENU } from "@/lib/settingsMenu";

// "Vikas and BIM must see nothing": the studio hangs off a platform-admin flag that is off by default,
// and everything that reaches it asks the same question. These tests fail the build if a new route or
// menu entry slips past it.

const SRC = join(__dirname, "..", "..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};

describe("the Newsletter Studio is behind its own flag", () => {
  it("the menu item needs newsletter_studio and its own workcenter", () => {
    const leaves = NAV.flatMap((g) => g.items.flatMap((i) => i.children ?? [i]));
    const item = leaves.find((l) => l.href === "/marketing/newsletters");
    expect(item?.featureKey).toBe("newsletter_studio");
    expect(item?.workcenterKey).toBe("marketing_newsletters");
  });

  it("the brand kit setting is hidden without the flag", () => {
    expect(SETTINGS_MENU.find((s) => s.id === "brand-kit")?.featureKey).toBe("newsletter_studio");
  });

  it("the object is owned by the flag, and the flag needs Marketing", () => {
    expect(OBJECT_FEATURE.newsletters).toBe("newsletter_studio");
    expect(featureForObject("newsletters")).toBe("newsletter_studio");
    expect(FEATURE_DEPENDENCIES.some((d) => d.key === "newsletter_studio" && d.needs === "marketing" && d.strength === "hard")).toBe(true);
    expect(unmetDependencies({ newsletter_studio: true }, "newsletter_studio")).toHaveLength(1);
    expect(unmetDependencies({ newsletter_studio: true, marketing: true }, "newsletter_studio")).toHaveLength(0);
  });

  it("every newsletter route resolves the tenant through newsletterAccess() before doing anything", () => {
    const routes = walk(join(SRC, "app", "api", "newsletters")).filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThanOrEqual(8);
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g)?.length ?? 0;
      const gates = src.match(/await newsletterAccess\(/g)?.length ?? 0;
      expect(gates, f).toBe(handlers);
      expect(src, f).not.toMatch(/tenant_id\s*[:=]\s*(body|json|searchParams)/);
    }
  });

  it("the public tracking routes verify a signed token inside handleClick/handleOpen, never read a URL from the request", () => {
    for (const rel of [["(print)", "marketing", "c", "[campaignId]", "[recipientId]", "[index]", "[token]", "route.ts"], ["(print)", "marketing", "o", "[campaignId]", "[recipientId]", "[token]", "route.ts"]]) {
      const src = readFileSync(join(SRC, "app", ...rel), "utf8");
      expect(src).not.toMatch(/searchParams|nextUrl\.search|req\.url/);
      expect(src).toMatch(/handle(Click|Open)\(/);
    }
  });

  it("no console.log in the studio", () => {
    const files = [...walk(join(SRC, "lib", "newsletter")), ...walk(join(SRC, "app", "api", "newsletters")), ...walk(join(SRC, "app", "(app)", "marketing", "newsletters"))].filter((f) => !f.endsWith(".test.ts"));
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/console\.log\(/);
  });

  it("no hard-coded hex colour in a studio component or stylesheet", () => {
    const dir = join(SRC, "app", "(app)", "marketing", "newsletters");
    for (const f of walk(dir).filter((x) => x.endsWith(".tsx"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(readFileSync(join(dir, "newsletter.module.css"), "utf8")).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
