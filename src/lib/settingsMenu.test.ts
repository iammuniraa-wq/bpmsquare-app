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
    expect(ids(menu)).not.toContain("email-templates");
    expect(ids(menu)).not.toContain("coverage");
  });

  it("drops a group that has no visible entries", () => {
    const menu = visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features: {} });
    expect(menu.map((g) => g.id)).not.toContain("workforce");
    expect(menu.map((g) => g.id)).not.toContain("service");
  });

  it("lets a non-admin reach an admin-only entry only through its workcenter grant", () => {
    const features = { quotations: true, assets: true };
    const without = visibleSettingsMenu({ isAdmin: false, canEdit: () => false, features });
    expect(ids(without)).not.toContain("statuses");
    const withGrant = visibleSettingsMenu({ isAdmin: false, canEdit: (w) => w === "quotations", features });
    expect(ids(withGrant)).toContain("statuses");
    expect(ids(withGrant)).not.toContain("team");
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
    expect(filterSettingsMenu(groups, "invite").flatMap((g) => g.items.map((i) => i.id))).toEqual(["team"]);
    expect(filterSettingsMenu(groups, "supplier").flatMap((g) => g.items.map((i) => i.id))).toContain("rfq");
    expect(filterSettingsMenu(groups, "workforce").flatMap((g) => g.items.map((i) => i.id))).toContain("workforce");
  });

  it("requires every typed word and returns everything for a blank query", () => {
    expect(filterSettingsMenu(groups, "team zzz")).toEqual([]);
    expect(filterSettingsMenu(groups, "   ")).toBe(groups);
  });
});

describe("activeSettingsItemId", () => {
  const groups = toMenuGroups(visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features: { wfm: true } }));

  it("matches a page and its sub-pages, and nothing at the landing", () => {
    expect(activeSettingsItemId(groups, "/settings/team")).toBe("team");
    expect(activeSettingsItemId(groups, "/settings/workforce")).toBe("workforce");
    expect(activeSettingsItemId(groups, "/settings/workforce/sites")).toBe("workforce");
    expect(activeSettingsItemId(groups, "/settings")).toBeNull();
  });

  it("never marks an external link active", () => {
    const g = toMenuGroups(visibleSettingsMenu({ isAdmin: true, canEdit: () => true, features: { business_roles: true } }));
    expect(activeSettingsItemId(g, "/administration/business-roles")).toBeNull();
  });
});
