import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const auth = vi.hoisted(() => ({ role: "admin" as "admin" | "member", tenantId: "t1", db: null as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: vi.fn(() => auth.db),
  requireTenantUser: vi.fn(async () => ({ tenantId: auth.tenantId, userId: "admin1", role: auth.role, supabase: auth.db })),
}));

import { fakeDb } from "@/lib/marketing/testFakeDb";
import { JURISDICTIONS, JURISDICTION_RULES } from "@/lib/marketing/jurisdictions";
import { CONSENT_SETTINGS_TIPS, RELAXED_WARNING } from "@/lib/marketing/consentSettingsTips";
import { tipTextProblems } from "@/lib/infoTip";
import { LIMITS_TIPS } from "@/lib/marketing/limitsTips";
import { limitsSettingsOf } from "@/lib/marketing/limits";
import { GET, PUT } from "@/app/api/settings/marketing-consent/route";
import { ConsentView, type ConsentState } from "./ConsentTab";
import { LimitsView, type LimitsMeta } from "./LimitsTab";
import { basisOf, dropBlankTopic, hiddenRuleCount, visibleRules, type Basis, type Jurisdiction } from "./consentLogic";
import { DEFAULT_TOPICS } from "@/lib/marketing/config";

const jurisdictions: Jurisdiction[] = JURISDICTIONS.map((code) => ({
  code, label: JURISDICTION_RULES[code].label, existing_customer_allowed: JURISDICTION_RULES[code].existingCustomerAllowed, plain: JURISDICTION_RULES[code].plain,
}));
const state = (over: Partial<ConsentState> = {}): ConsentState => ({ topics: DEFAULT_TOPICS, defaults: {}, home: "SA", trackOpens: false, ...over });
const html = (over: Partial<ConsentState> = {}, studio = true, openPanel?: Parameters<typeof ConsentView>[0]["openPanel"]) =>
  renderToString(createElement(ConsentView, { state: state(over), jurisdictions, studio, set: () => {}, openPanel })).replace(/<!-- -->/g, "");

describe("the rows of the rules table", () => {
  it("starts with the country the workspace sits in and hides the other eight", () => {
    const rows = visibleRules(jurisdictions, {}, "QA", false);
    expect(rows.map((j) => j.code)).toEqual(["QA"]);
    expect(hiddenRuleCount(jurisdictions, {}, "QA")).toBe(8);
  });

  it("never hides a country that has been relaxed, and puts the home country first", () => {
    const defaults: Record<string, Basis> = { AE: "existing_customer" };
    expect(visibleRules(jurisdictions, defaults, "SA", false).map((j) => j.code)).toEqual(["SA", "AE"]);
    expect(visibleRules(jurisdictions, defaults, "SA", true)).toHaveLength(9);
    expect(visibleRules(jurisdictions, defaults, "SA", true)[0].code).toBe("SA");
  });

  it("reads a relaxed choice on a country that does not allow it as strict", () => {
    const india = jurisdictions.find((j) => j.code === "IN")!;
    expect(basisOf(india, { IN: "existing_customer" })).toBe("consent_required");
    expect(visibleRules(jurisdictions, { IN: "existing_customer" }, "SA", false).map((j) => j.code)).toEqual(["SA"]);
  });

  it("drops a topic that was added and left without a name, and keeps a named one", () => {
    const withBlank = [...DEFAULT_TOPICS, { key: "", label: " ", hint: "" }];
    expect(dropBlankTopic(withBlank, 4)).toEqual(DEFAULT_TOPICS);
    expect(dropBlankTopic(DEFAULT_TOPICS, 1)).toBe(DEFAULT_TOPICS);
  });
});

describe("the Consent screen", () => {
  it("is two tables, one row per rule and one per topic, and a row opens its panel", () => {
    const out = html();
    expect(out.match(/<table /g)).toHaveLength(2);
    expect(out).toContain('aria-label="Rules by country"');
    expect(out).toContain('aria-label="Topics"');
    expect(out).toContain('aria-label="Saudi Arabia: edit the rule"');
    for (const t of DEFAULT_TOPICS) expect(out).toContain(`aria-label="${t.label}: edit"`);
    expect(out).not.toContain('role="dialog"');
  });

  it("shows one country row to start with, marked as the home country, and a way to show the others", () => {
    const out = html({ home: "SA" });
    expect(out.match(/: edit the rule"/g)).toHaveLength(1);
    expect(out).toContain("Your country");
    expect(out).toContain("Show other countries (8)");
  });

  it("prints none of the explanations (they sit behind the i) and none of the strict-default sentences", () => {
    const out = html({ defaults: {} });
    for (const text of Object.values(CONSENT_SETTINGS_TIPS)) expect(out, text).not.toContain(text);
    expect(out).not.toContain(RELAXED_WARNING);
    expect(out).not.toContain("Everyone needs to have said yes first");
    for (const j of jurisdictions) expect(out).not.toContain(j.plain);
    expect(out.match(/aria-label="About [^"]+"/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("marks a relaxed country in the table so it can be seen without opening it", () => {
    const out = html({ defaults: { SA: "existing_customer" } });
    expect(out).toContain("Also existing customers");
    expect(out).not.toContain(RELAXED_WARNING);
  });

  it("holds counting opens, once, only for a workspace with the Newsletter Studio", () => {
    expect(html({}, true).match(/aria-label="Count newsletter opens"/g)).toHaveLength(1);
    expect(html({}, false)).not.toContain("Count newsletter opens");
    expect(html({ trackOpens: true })).toMatch(/aria-checked="true" aria-label="Count newsletter opens"/);
  });

  it("opens a rule panel with the choice, and shows the warning only while the relaxed choice is on", () => {
    const strict = html({}, true, { kind: "rule", code: "SA" });
    expect(strict).toContain('role="dialog"');
    expect(strict).toContain("Also existing customers, about similar products");
    expect(strict).not.toContain(RELAXED_WARNING);
    const relaxed = html({ defaults: { SA: "existing_customer" } }, true, { kind: "rule", code: "SA" });
    expect(relaxed).toContain(RELAXED_WARNING);
  });

  it("offers no relaxed choice for a country that does not allow one", () => {
    const out = html({ home: "IN" }, true, { kind: "rule", code: "IN" });
    expect(out).toMatch(/<select[^>]*disabled/);
    expect(out).not.toContain("Also existing customers, about similar products");
  });

  it("opens a topic panel with its name, what it covers, and a way to remove it", () => {
    const out = html({}, true, { kind: "topic", index: 0 });
    expect(out).toContain('value="Offers"');
    expect(out).toContain("Remove topic");
    expect(out).toContain(">Done<");
  });

  it("keeps the tap targets at least 44 px", () => {
    expect(html()).toMatch(/min-height:44px/);
  });
});

describe("the Limits form", () => {
  const meta = (over: Partial<LimitsMeta> = {}): LimitsMeta => ({ timezone: "Asia/Riyadh", source: "workforce", modules: { journeys: true, whatsapp: true }, ...over });
  const limits = (m = meta(), over = {}) => renderToString(createElement(LimitsView, { s: { ...limitsSettingsOf({}), ...over }, meta: m, set: () => {} })).replace(/<!-- -->/g, "");

  it("is about six controls and one timezone chip", () => {
    const out = limits();
    expect(out.match(/<select /g)).toHaveLength(2);
    expect(out.match(/<input /g)).toHaveLength(2);
    expect(out.match(/aria-pressed=/g)).toHaveLength(7);
    expect(out).toContain("Asia/Riyadh");
    expect(out).not.toContain("(default)");
  });

  it("says when the timezone is only the product default", () => {
    expect(limits(meta({ timezone: "Asia/Kolkata", source: "default" }))).toContain("Asia/Kolkata (default)");
  });

  it("shows the stored values: Friday off, quiet from 20:00 to 08:00, one email a day, one WhatsApp a week", () => {
    const out = limits();
    expect(out).toMatch(/aria-pressed="true"[^>]*>Fri</);
    expect(out).toMatch(/aria-pressed="false"[^>]*>Sun</);
    expect(out).toMatch(/<option value="20" selected="">20:00/);
    expect(out).toMatch(/<option value="8" selected="">08:00/);
    expect(out.match(/<input [^>]*value="1"/g)).toHaveLength(2);
  });

  it("shows only the modules the workspace has", () => {
    const waOnly = limits(meta({ modules: { journeys: false, whatsapp: true } }));
    expect(waOnly).toContain("WhatsApp messages a week");
    expect(waOnly).not.toContain("Quiet from");
    expect(waOnly).not.toContain("aria-pressed");
    const jOnly = limits(meta({ modules: { journeys: true, whatsapp: false } }));
    expect(jOnly).not.toContain("WhatsApp messages a week");
    expect(jOnly).toContain("Quiet from");
  });

  it("prints none of the explanations", () => {
    const out = limits();
    for (const text of Object.values(LIMITS_TIPS)) expect(out, text).not.toContain(text);
  });
});

describe("every Consent explanation fits the InfoTip limit", () => {
  it.each(Object.entries(CONSENT_SETTINGS_TIPS))("%s", (_k, text) => expect(tipTextProblems(text)).toEqual([]));
});

describe("the consent route holds counting opens", () => {
  const put = (body: unknown) => PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }) as never);
  let db: ReturnType<typeof fakeDb>;
  const marketing = () => (db.tables.tenants.find((t) => t.id === "t1")!.config as { marketing: Record<string, unknown> }).marketing;

  beforeEach(() => {
    auth.role = "admin"; auth.tenantId = "t1";
    db = fakeDb({ tenants: [{ id: "t1", features: { marketing: true, marketing_scoring: true, newsletter_studio: true }, config: { marketing: { track_opens: true } } }], consent_state: [] });
    auth.db = db.client;
  });

  it("reports the switch and whether the Newsletter Studio is on", async () => {
    expect(await (await GET()).json()).toMatchObject({ track_opens: true, newsletter_studio: true });
  });

  it("saves the switch, and leaves it alone when an older page does not send it", async () => {
    expect((await put({ topics: DEFAULT_TOPICS })).status).toBe(200);
    expect(marketing().track_opens).toBe(true);
    expect((await put({ topics: DEFAULT_TOPICS, track_opens: false })).status).toBe(200);
    expect(marketing().track_opens).toBe(false);
  });

  it("writes the switch to change history", async () => {
    await put({ topics: DEFAULT_TOPICS, track_opens: false });
    const row = db.tables.change_log?.[0];
    expect(row).toMatchObject({ tenant_id: "t1", object_type: "marketing_settings" });
    expect((row.changes as { field: string }[]).map((c) => c.field)).toContain("track_opens");
  });
});

describe("Brand kit no longer holds it", () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, "..", "..", "..", "..", ...p), "utf8");
  it("the screen and the route have no opens switch", () => {
    expect(read("app", "(app)", "settings", "brand-kit", "BrandKitClient.tsx")).not.toMatch(/Counting opens|trackOpens|track_opens/);
    expect(read("app", "api", "settings", "brand-kit", "route.ts")).not.toMatch(/track_opens/);
  });
});
