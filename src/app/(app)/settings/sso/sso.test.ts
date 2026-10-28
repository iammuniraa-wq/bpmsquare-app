import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({ role: "admin" as "admin" | "member" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/settings/sso",
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/supabase-server", () => ({ requireTenantUser: async () => ({ role: state.role }) }));

import SsoPage from "./page";
import { SSO_TIPS } from "./tips";
import { tipTextProblems } from "@/lib/infoTip";
import { SETTINGS_MENU } from "@/lib/settingsMenu";
import { ROUTES } from "@/lib/constants";

describe("Settings > Single sign-on", () => {
  it("is a header, one Coming soon chip and an i, with no form and no running text", async () => {
    state.role = "admin";
    const out = renderToString((await SsoPage()) as ReactElement);
    expect(out).toContain("Single sign-on");
    expect(out).toContain("Coming soon");
    expect(out).toContain("About Single sign-on");
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<input");
  });

  it("is admin only", async () => {
    state.role = "member";
    await expect(SsoPage()).rejects.toThrow("REDIRECT:");
  });

  it("keeps its explanation inside the InfoTip limit", () => {
    expect(tipTextProblems(SSO_TIPS.page)).toEqual([]);
  });

  it("sits in the same menu group as People, admin only, with no feature flag", () => {
    const sso = SETTINGS_MENU.find((m) => m.id === "sso");
    const people = SETTINGS_MENU.find((m) => m.id === "people");
    expect(sso).toMatchObject({ href: ROUTES.settingsSso, adminOnly: true, group: people?.group });
    expect(ROUTES.settingsSso).toBe("/settings/sso");
    expect(sso?.featureKey).toBeUndefined();
    expect(sso?.featureAnyOf).toBeUndefined();
  });
});
