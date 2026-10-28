import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));

import { NAV } from "@/lib/constants";
import { tipTextProblems } from "@/lib/infoTip";
import { SETTINGS_TIPS } from "@/lib/settingsTips";
import { appearanceDirty, draftFromTenant, menuGroups, menuRows, planAppearanceSave, themeOf } from "./appearanceLogic";
import ThemeTab, { themeTiles } from "./ThemeTab";
import MenuTab from "./MenuTab";
import DashboardTab from "./DashboardTab";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const tenant = (config = {}, accent = "#378ADD") => ({ accent_color: accent, config });

describe("the draft", () => {
  it("reads the stored theme the way the app does", () => {
    expect(themeOf(undefined)).toBe("classic");
    expect(themeOf("modern3")).toBe("modern");
    expect(themeOf("nextgen2")).toBe("nextgen2");
  });
  it("opens the dashboard the way the dashboard resolves it: curated on Spectacular, adaptive elsewhere", () => {
    expect(draftFromTenant(tenant({ appearance: { ui_theme: "spectacular" } })).dashboardMode).toBe("curated");
    expect(draftFromTenant(tenant({})).dashboardMode).toBe("adaptive");
    expect(draftFromTenant(tenant({ appearance: { dashboard_mode: "curated" } })).dashboardMode).toBe("curated");
  });
  it("reads the Tender desk default as Bold tiles unless the workspace chose Control room (anything else reads as Bold)", () => {
    expect(draftFromTenant(tenant({})).tenderDeskStyle).toBe("bold");
    expect(draftFromTenant(tenant({ appearance: { tender_desk_style: "control" } })).tenderDeskStyle).toBe("control");
    expect(draftFromTenant(tenant({ appearance: { tender_desk_style: "classic" } })).tenderDeskStyle).toBe("bold");
  });
  it("starts with Nova's chrome switches on, as the hooks do", () => {
    expect(draftFromTenant(tenant({})).chrome).toEqual({ top_bar_identity: true, command_palette: true, navy_sidebar: true });
  });
});

describe("one Save over three tabs", () => {
  const initial = draftFromTenant(tenant({ appearance: { ui_theme: "classic", compact_sidebar: true }, nav_hidden_hrefs: ["/a"] }));

  it("writes nothing when nothing changed", () => {
    expect(appearanceDirty(initial, initial)).toBe(false);
    expect(planAppearanceSave(initial, initial, { ui_theme: "classic", compact_sidebar: true })).toEqual({ reload: false });
  });

  it("changes the accent through the workspace route and the rest through the config route", () => {
    const plan = planAppearanceSave(initial, { ...initial, accent: "#639922", navHidden: ["/a", "/b"] }, { ui_theme: "classic", compact_sidebar: true });
    expect(plan.workspace).toEqual({ accent_color: "#639922" });
    expect(plan.config).toEqual({ nav_hidden_hrefs: ["/a", "/b"] });
    expect(plan.reload).toBe(false);
  });

  it("carries the stored appearance forward, since the route replaces it wholesale, and reloads on a theme change", () => {
    const plan = planAppearanceSave(initial, { ...initial, theme: "nextgen" }, { ui_theme: "classic", compact_sidebar: true, nova_accent_color: "#FF6B35" });
    expect(plan.config?.appearance).toEqual({ ui_theme: "nextgen", compact_sidebar: true, nova_accent_color: "#FF6B35" });
    expect(plan.reload).toBe(true);
  });

  it("clears Nova's colour and Spectacular's colours instead of storing the default", () => {
    const start = draftFromTenant(tenant({ appearance: { ui_theme: "nextgen2", nova_accent_color: "#FF6B35", spectacular_colors: { accent: "#111111" } } }));
    const plan = planAppearanceSave(start, { ...start, novaAccent: "", spec: null }, { ui_theme: "nextgen2", nova_accent_color: "#FF6B35", spectacular_colors: { accent: "#111111" } });
    expect(plan.config?.appearance).toEqual({ ui_theme: "nextgen2" });
  });

  it("stores the Tender desk default next to the other appearance keys, without a reload, and only when it changed", () => {
    const stored = { ui_theme: "classic" as const, compact_sidebar: true };
    const plan = planAppearanceSave(initial, { ...initial, tenderDeskStyle: "control" }, stored);
    expect(plan.config?.appearance).toEqual({ ...stored, tender_desk_style: "control" });
    expect(plan.reload).toBe(false);
    expect(appearanceDirty(initial, { ...initial, tenderDeskStyle: "control" })).toBe(true);
    expect(planAppearanceSave(initial, { ...initial }, stored).config).toBeUndefined();
  });

  it("sends the dashboard blocks together with their topics, capped at four", () => {
    const plan = planAppearanceSave(initial, { ...initial, news: true, topics: "a, b, c, d, e" }, undefined);
    expect(plan.config?.dashboard_extras).toEqual({ business_news: true, product_tips: false, news_topics: ["a", "b", "c", "d"] });
  });

  it("treats the same hidden set in another order as unchanged", () => {
    expect(appearanceDirty({ ...initial, navHidden: ["/a", "/b"] }, { ...initial, navHidden: ["/b", "/a"] })).toBe(false);
  });
});

describe("Theme tab", () => {
  const features = { next_experience: true, spectacular_theme: true };
  const render = (theme: string, f = features) => html(createElement(ThemeTab, { draft: { ...draftFromTenant(tenant({})), theme: theme as never }, features: f, accent: "#378ADD", onChange: () => {} }));

  it("offers only the themes this workspace was given", () => {
    expect(themeTiles({}).map((t) => t.value)).toEqual(["classic", "modern", "nextgen"]);
    expect(themeTiles(features).map((t) => t.value)).toEqual(["classic", "modern", "nextgen", "nextgen2", "spectacular", "spectacular_purple"]);
  });

  it("has one colour row, whichever theme is chosen, and no descriptions under the tiles", () => {
    for (const theme of ["classic", "nextgen2", "spectacular_purple"]) {
      const out = render(theme);
      expect(out.match(/>Colour</g), theme).toHaveLength(1);
      expect(out).not.toContain("Dark navy sidebar, the original look");
    }
  });

  it("shows Nova's own presets for Nova, the mixes for Spectacular Purple, and the accent presets otherwise", () => {
    expect(render("nextgen2")).toContain("Pink");
    expect(render("spectacular_purple")).toContain("Midnight");
    expect(render("classic")).not.toContain("Midnight");
    expect(render("classic")).not.toContain("Pink");
  });

  it("keeps layout and custom colours behind one More, only where they apply", () => {
    expect(render("classic")).not.toContain("<details");
    expect(render("nextgen")).toContain("Sign-in name in the top right");
    expect(render("nextgen").match(/<details/g)).toHaveLength(1);
    expect(render("spectacular_purple")).toContain("Reset to violet");
  });
});

describe("Menu tab", () => {
  const features = { quotations: true, accounts: true, contacts: true, cases: true };
  const render = (hidden: string[]) => html(createElement(MenuTab, { hidden, features, accent: "#378ADD", onChange: () => {}, onReset: () => {} }));

  it("is one list of switches with the sidebar's own group names, no pager", () => {
    const rows = menuRows(features);
    expect(rows.length).toBeGreaterThan(3);
    expect(new Set(rows.map((r) => `${r.indent}:${r.href}`)).size).toBe(rows.length);
    const out = render([]);
    expect(out.match(/role="switch"/g)).toHaveLength(rows.length);
    expect(out).not.toMatch(/Previous|Next page|aria-label="Page/);
    for (const g of menuGroups(rows)) expect(out).toContain(g.group.replace(/&/g, "&amp;"));
  });

  it("offers a reset link and shows hidden rows as off", () => {
    const first = menuRows(features).find((r) => !r.children?.length)!;
    const out = render([first.href]);
    expect(out).toContain("Reset to defaults");
    expect(out).toMatch(/aria-checked="false"[^>]*aria-label="/);
  });

  it("leaves out admin-only and unbought items", () => {
    const hrefs = menuRows({}).map((r) => r.href);
    const adminOnly = NAV.flatMap((g) => g.items).filter((i) => i.adminOnly).map((i) => i.href);
    for (const h of adminOnly) expect(hrefs).not.toContain(h);
  });
});

describe("Dashboard tab", () => {
  const draft = draftFromTenant(tenant({}));
  const render = (d = draft) => html(createElement(DashboardTab, { draft: d, accent: "#378ADD", onChange: () => {} }));

  it("offers the Tender desk style only to a workspace with the tender edition, as two choices behind one tip", () => {
    const without = render();
    expect(without).not.toContain("Home style for tender workspaces");
    const withFlag = html(createElement(DashboardTab, { draft, accent: "#378ADD", features: { gcc_tender: true }, onChange: () => {} }));
    expect(withFlag).toContain("Home style for tender workspaces");
    expect(withFlag).toContain("Bold tiles");
    expect(withFlag).toContain("Control room");
    expect(withFlag).not.toContain("Classic home");
    expect(withFlag).toMatch(/aria-pressed="true"[^>]*>Bold tiles/);
    expect(withFlag.match(/role="switch"/g)).toHaveLength(2);
  });

  it("is the opening choice and two switches, with the topics box only when news is on", () => {
    const out = render();
    expect(out).toContain("Opens on");
    expect(out.match(/role="switch"/g)).toHaveLength(2);
    expect(out).not.toContain("Topics, up to 4");
    expect(render({ ...draft, news: true })).toContain("Topics, up to 4");
  });
});

describe("explanations", () => {
  it("every Appearance text fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(SETTINGS_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});
