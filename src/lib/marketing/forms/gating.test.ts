import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "@/lib/constants";
import { OBJECT_FEATURE, featureForObject } from "@/lib/objectFeatures";
import { FEATURE_DEPENDENCIES, unmetDependencies } from "@/lib/moduleDependencies";
import { PUBLIC_KEY_PATTERN, embedSnippet, hostedUrl, newPublicKey } from "./links";
import { formsEnabled } from "./submit";

// "Vikas and BIM must see nothing": Forms hangs off a platform-admin flag that is off by default, and
// everything that reaches it asks the same question. These fail the build if a new route, page or
// public path slips past it.

const SRC = join(__dirname, "..", "..", "..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
};
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

describe("Forms are behind their own flag", () => {
  it("the menu item needs marketing_forms and its own workcenter", () => {
    const leaves = NAV.flatMap((g) => g.items.flatMap((i) => i.children ?? [i]));
    const item = leaves.find((l) => l.href === "/marketing/forms");
    expect(item?.featureKey).toBe("marketing_forms");
    expect(item?.workcenterKey).toBe("marketing_forms");
  });

  it("needs BOTH the Marketing module and the platform-admin flag", () => {
    expect(formsEnabled({ marketing: true, marketing_forms: true })).toBe(true);
    expect(formsEnabled({ marketing: true })).toBe(false);
    expect(formsEnabled({ marketing_forms: true })).toBe(false);
    expect(formsEnabled({ marketing: true, marketing_forms: false })).toBe(false);
    expect(formsEnabled(null)).toBe(false);
  });

  it("the object is owned by the flag, and the flag needs Marketing", () => {
    expect(OBJECT_FEATURE.forms).toBe("marketing_forms");
    expect(featureForObject("forms")).toBe("marketing_forms");
    expect(FEATURE_DEPENDENCIES.some((d) => d.key === "marketing_forms" && d.needs === "marketing" && d.strength === "hard")).toBe(true);
    expect(unmetDependencies({ marketing_forms: true }, "marketing_forms")).toHaveLength(1);
    expect(unmetDependencies({ marketing_forms: true, marketing: true }, "marketing_forms")).toHaveLength(0);
  });

  it("every signed-in forms route resolves the tenant through formsAccess() before doing anything", () => {
    const routes = walk(join(SRC, "app", "api", "marketing-forms")).filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThanOrEqual(2);
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g)?.length ?? 0;
      const gates = src.match(/await formsAccess\(/g)?.length ?? 0;
      expect(gates, f).toBe(handlers);
      expect(src, f).not.toMatch(/tenant_id\s*[:=]\s*(body|json|searchParams)/);
    }
  });

  it("every forms page starts with formsPage(), which checks the workcenter and both flags", () => {
    const dir = join(SRC, "app", "(app)", "marketing", "forms");
    for (const f of walk(dir).filter((x) => x.endsWith("page.tsx"))) expect(readFileSync(f, "utf8"), f).toMatch(/await formsPage\(\)/);
    const data = readFileSync(join(dir, "pageData.ts"), "utf8");
    expect(data).toMatch(/requireWorkcenterView\("marketing_forms"\)/);
    expect(data).toMatch(/requireFeature\("marketing"\)/);
    expect(data).toMatch(/requireFeature\("marketing_forms"\)/);
  });
});

describe("the public paths", () => {
  const proxy = read("proxy.ts");

  it("are six anchored patterns and nothing broader", () => {
    for (const re of [
      String.raw`/^\/f\/[^/]+$/`,
      String.raw`/^\/api\/f\/[^/]+$/`,
      String.raw`/^\/marketing\/preferences\/[^/]+\/[^/]+$/`,
      String.raw`/^\/api\/marketing\/preferences\/[^/]+\/[^/]+$/`,
      String.raw`/^\/marketing\/confirm\/[^/]+\/[^/]+$/`,
      String.raw`/^\/api\/marketing\/confirm\/[^/]+\/[^/]+$/`,
    ]) expect(proxy).toContain(`${re}.test(pathname)`);
    expect(proxy).not.toMatch(/pathname\.startsWith\("\/f\//);
    expect(proxy).not.toMatch(/startsWith\("\/api\/marketing-forms/);
  });

  it("the public submit and preference routes never read a tenant from the request", () => {
    for (const rel of [["app", "api", "f", "[key]", "route.ts"], ["app", "api", "marketing", "preferences", "[contactId]", "[token]", "route.ts"]]) {
      const src = read(...rel);
      expect(src, rel.join("/")).not.toMatch(/tenant_id|tenantId|searchParams|nextUrl\.search/);
    }
  });

  it("the preference route verifies the signed token before reading anything", () => {
    const src = read("app", "api", "marketing", "preferences", "[contactId]", "[token]", "route.ts");
    expect(src.indexOf("verifyPreferenceToken")).toBeGreaterThan(-1);
    expect(src.indexOf("verifyPreferenceToken")).toBeLessThan(src.indexOf("req.text()"));
    const page = read("app", "(print)", "marketing", "preferences", "[contactId]", "[token]", "page.tsx");
    expect(page.indexOf("verifyPreferenceToken(contactId, token)")).toBeLessThan(page.indexOf("loadPreferences("));
  });

  it("the confirm route and page verify the signed, expiring token before reading anything, and never read a tenant from the request", () => {
    const route = read("app", "api", "marketing", "confirm", "[contactId]", "[token]", "route.ts");
    expect(route.indexOf("verifyConfirmToken(contactId, token)")).toBeGreaterThan(-1);
    expect(route.indexOf("verifyConfirmToken(contactId, token)")).toBeLessThan(route.indexOf("createAdminSupabase()"));
    expect(route).not.toMatch(/searchParams|nextUrl\.search|req\.json|req\.text|body\./);
    const page = read("app", "(print)", "marketing", "confirm", "[contactId]", "[token]", "page.tsx");
    expect(page.indexOf("verifyConfirmToken(contactId, token)")).toBeLessThan(page.indexOf("loadConfirmView("));
    expect(page).not.toMatch(/notFound\(|throw /);
  });

  it("the hosted page answers not found when the form cannot be reached", () => {
    expect(read("app", "(print)", "f", "[slug]", "page.tsx")).toMatch(/if \(!page\) notFound\(\)/);
  });
});

describe("links and keys", () => {
  it("a public key is long, random and not a uuid", () => {
    const a = newPublicKey();
    expect(a).toMatch(PUBLIC_KEY_PATTERN);
    expect(newPublicKey()).not.toBe(a);
    expect(a).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
  it("addresses are built from the tenant's own domain, never the primary host", () => {
    expect(hostedUrl("crm.alnoor.test", "contact")).toBe("https://crm.alnoor.test/f/contact");
    const snip = embedSnippet("crm.alnoor.test", "contact", 'Say "hi" <now>');
    expect(snip).toContain('src="https://crm.alnoor.test/f/contact?embed=1"');
    expect(snip).toContain('title="Say &quot;hi&quot; &lt;now&gt;"');
    expect(snip).toMatch(/^<iframe /);
  });
});

describe("house rules", () => {
  const files = () => [
    ...walk(join(SRC, "lib", "marketing", "forms")), ...walk(join(SRC, "app", "api", "marketing-forms")), ...walk(join(SRC, "app", "api", "f")),
    ...walk(join(SRC, "app", "(app)", "marketing", "forms")), ...walk(join(SRC, "app", "(print)", "f")),
    join(SRC, "components", "marketing", "PublicFormView.tsx"), join(SRC, "components", "marketing", "PreferencesForm.tsx"), join(SRC, "components", "marketing", "publicForm.module.css"),
  ].filter((f) => !f.endsWith(".test.ts"));

  it("no console.log and nothing inserted as HTML", () => {
    for (const f of files()) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/console\.log\(/);
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML\s*=/);
    }
  });

  it("no hard-coded hex colour in a component or stylesheet", () => {
    for (const f of files().filter((x) => /\.(tsx|css)$/.test(x))) expect(readFileSync(f, "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
