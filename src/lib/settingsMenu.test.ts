import { describe, expect, it } from "vitest";
import {
  activeSettingsItemId, filterSettingsMenu, SETTINGS_MENU, toMenuGroups, visibleSettingsMenu,
} from "./settingsMenu";

const ids = (g: ReturnType<typeof visibleSettingsMenu>) => g.flatMap((x) => x.items.map((i) => i.id));

describe("visibleSettingsMenu", () => {
  it("shows an admin of a Workforce-only tenant nothing from other modules", () => {
    const menu = visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features: { wfm: true } });
    expect(ids(menu)).toContain("workforce");
    expect(ids(menu)).not.toContain("entities");
    expect(ids(menu)).not.toContain("quotations");
    expect(ids(menu)).not.toContain("coverage");
  });

  it("drops a group that has no visible entries", () => {
    const menu = visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features: {} });
    expect(menu.map((g) => g.id)).not.toContain("workforce");
    expect(menu.map((g) => g.id)).not.toContain("service");
  });

  it("lets a non-admin reach an admin-only entry only through its workcenter grant", () => {
    const features = { quotations: true, products: true };
    const without = visibleSettingsMenu({ isAdmin: false, canEdit: () => false, features });
    expect(ids(without)).not.toContain("products");
    const withGrant = visibleSettingsMenu({ isAdmin: false, canEdit: (w) => w === "quotations", features });
    expect(ids(withGrant)).toContain("products");
    expect(ids(withGrant)).not.toContain("people");
  });

  it("folds five quotation pages into one Quotations entry and two pricing entries into one Pricing entry (batch S3)", () => {
    const all = SETTINGS_MENU.map((m) => m.id);
    for (const gone of ["statuses", "quote-types", "text-templates", "email-templates", "asset-print-fields", "dynamic-pricing"]) expect(all, gone).not.toContain(gone);
    expect(all).toEqual(expect.arrayContaining(["quotations", "pricing"]));
    expect(SETTINGS_MENU.find((m) => m.id === "quotations")?.href).toBe("/settings/quotations");
    expect(SETTINGS_MENU.find((m) => m.id === "pricing")?.label).toBe("Pricing");
  });

  it("gates Quotations by Quotations or Assets (Print), Pricing by Quotations or Dynamic Pricing, both admin only", () => {
    const ids = (features: Record<string, boolean>, isAdmin = true) =>
      visibleSettingsMenu({ isAdmin, canEdit: () => true, features }).flatMap((g) => g.items.map((m) => m.id));
    expect(ids({ quotations: true })).toEqual(expect.arrayContaining(["quotations", "pricing"]));
    expect(ids({ assets: true })).toContain("quotations");
    expect(ids({ assets: true })).not.toContain("pricing");
    expect(ids({ pricing_engine: true })).toContain("pricing");
    expect(ids({ pricing_engine: true })).not.toContain("quotations");
    expect(ids({ wfm: true })).not.toContain("quotations");
    const member = ids({ quotations: true, assets: true, pricing_engine: true }, false);
    expect(member).not.toContain("quotations");
    expect(member).not.toContain("pricing");
  });

  it("keeps Quotations and Pricing in Sales, and finds them by every name the five pages had", () => {
    const menu = visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features: { quotations: true, assets: true } });
    const groupOf = (id: string) => menu.find((g) => g.items.some((i) => i.id === id))?.id;
    expect(groupOf("quotations")).toBe("sales");
    expect(groupOf("pricing")).toBe("sales");
    const entry = SETTINGS_MENU.find((i) => i.id === "quotations");
    expect(entry?.keywords).toEqual(expect.arrayContaining(["pipeline", "quote statuses", "quote types", "text templates", "email templates", "asset print fields"]));
    expect(SETTINGS_MENU.find((i) => i.id === "pricing")?.keywords).toEqual(expect.arrayContaining(["small scale pricing", "dynamic pricing"]));
  });

  it("describes Developer and Connectors without stale claims", () => {
    const all = SETTINGS_MENU;
    expect(all.find((i) => i.id === "developer")?.description).not.toMatch(/endpoints|catalogue/i);
    expect(all.find((i) => i.id === "connectors")?.description).not.toMatch(/today|on the way/i);
  });

  it("lists one Workforce entry, gated on the module and admin (batch S5)", () => {
    const wf = (admin: boolean, features: Record<string, boolean>) =>
      visibleSettingsMenu({ isAdmin: admin, canEdit: () => false, features }).find((g) => g.id === "workforce")?.items.length ?? 0;
    expect(wf(true, { wfm: true })).toBe(1);
    expect(wf(true, {})).toBe(0);
    expect(wf(false, { wfm: true })).toBe(0);
  });

  it("folds Company, Appearance and Products into one entry each (batch S2)", () => {
    const ids = (features: Record<string, boolean>) =>
      visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features }).flatMap((g) => g.items.map((i) => i.id));
    const all = ids({ quotations: true, products: true, wfm: true });
    for (const gone of ["entities", "currency", "number-ranges", "navigation", "dashboard", "reset", "product-categories", "item-types"]) expect(all).not.toContain(gone);
    expect(all).toEqual(expect.arrayContaining(["company", "appearance", "products"]));
    // Company and Appearance reach every workspace; Products only one with Products or Quotations.
    expect(ids({ wfm: true })).toEqual(expect.arrayContaining(["company", "appearance"]));
    expect(ids({ wfm: true })).not.toContain("products");
    expect(ids({ quotations: true })).toContain("products");
  });

  it("keeps Company, Appearance and Products to admins (every write behind them is an admin write)", () => {
    const features = { quotations: true, products: true };
    const member = visibleSettingsMenu({ isAdmin: false, canEdit: () => false, features }).flatMap((g) => g.items.map((i) => i.id));
    expect(member).not.toContain("company");
    expect(member).not.toContain("appearance");
    expect(member).not.toContain("products");
  });

  it("finds the retired Workforce pages by their old names", () => {
    const groups = toMenuGroups(visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features: { wfm: true } }));
    for (const q of ["shifts", "sites", "leave", "kiosk", "geofence", "reminders", "employment", "attendance"]) {
      expect(filterSettingsMenu(groups, q).flatMap((g) => g.items.map((i) => i.id)), q).toContain("workforce");
    }
  });

  it("keeps every entry id and href unique", () => {
    expect(new Set(SETTINGS_MENU.map((m) => m.id)).size).toBe(SETTINGS_MENU.length);
    expect(new Set(SETTINGS_MENU.map((m) => m.href)).size).toBe(SETTINGS_MENU.length);
  });
});

describe("filterSettingsMenu", () => {
  const groups = toMenuGroups(visibleSettingsMenu({
    isAdmin: true, canEdit: () => true, features: { wfm: true, quotations: true, assets: true, rfq: true },
  }));

  it("matches by name, description, keyword and group", () => {
    expect(filterSettingsMenu(groups, "invite").flatMap((g) => g.items.map((i) => i.id))).toEqual(["people"]);
    expect(filterSettingsMenu(groups, "supplier").flatMap((g) => g.items.map((i) => i.id))).toContain("rfq");
    expect(filterSettingsMenu(groups, "workforce").flatMap((g) => g.items.map((i) => i.id))).toContain("workforce");
  });

  it("still finds pages by the names they had before the split", () => {
    const find = (q: string) => filterSettingsMenu(groups, q).flatMap((g) => g.items.map((i) => i.id));
    expect(find("general")).toEqual(expect.arrayContaining(["company", "appearance", "developer"]));
    expect(find("statuses")).toContain("quotations");
    expect(find("statuses & assets")).toContain("quotations");
    expect(find("appearance")).toContain("appearance");
  });

  it("finds the folded pages by the names they had before batch S2", () => {
    const find = (q: string) => filterSettingsMenu(groups, q).flatMap((g) => g.items.map((i) => i.id));
    expect(find("entities & tax")).toContain("company");
    expect(find("number ranges")).toContain("company");
    expect(find("currency")).toContain("company");
    expect(find("navigation visibility")).toContain("appearance");
    expect(find("reset layout")).toContain("appearance");
    expect(find("dashboard content")).toContain("appearance");
  });

  it("requires every typed word and returns everything for a blank query", () => {
    expect(filterSettingsMenu(groups, "people zzz")).toEqual([]);
    expect(filterSettingsMenu(groups, "   ")).toBe(groups);
  });
});

describe("activeSettingsItemId", () => {
  const groups = toMenuGroups(visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features: { wfm: true } }));

  it("matches a page and its sub-pages, and nothing at the landing", () => {
    expect(activeSettingsItemId(groups, "/settings/people")).toBe("people");
    expect(activeSettingsItemId(groups, "/settings/workforce")).toBe("workforce");
    expect(activeSettingsItemId(groups, "/settings/workforce/sites")).toBe("workforce");
    expect(activeSettingsItemId(groups, "/settings")).toBeNull();
  });

  it("never marks an external link active", () => {
    const g = toMenuGroups(visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features: { pricing_engine: true } }));
    expect(activeSettingsItemId(g, "/pricing/setup")).toBeNull();
  });

  it("has one People entry and none for the retired Team, Business users and Business roles", () => {
    const people = SETTINGS_MENU.filter((m) => /people|team|business/i.test(m.id));
    expect(people.map((m) => m.id)).toEqual(["people"]);
    expect(people[0].featureKey).toBeUndefined();
    expect(people[0].keywords).toEqual(expect.arrayContaining(["team", "business users", "business roles"]));
  });
});
