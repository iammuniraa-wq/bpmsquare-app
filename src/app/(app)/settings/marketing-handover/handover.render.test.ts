import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));

import { HandoverView } from "./HandoverClient";
import { handoverOf } from "@/lib/marketing/leads/handover";
import { HANDOVER_TIPS } from "@/lib/marketing/leads/tips";

const people = [{ user_id: "u1", label: "Rana" }, { user_id: "u2", label: "Omar" }, { user_id: "u3", label: "Lina" }];
const html = (over: Partial<ReturnType<typeof handoverOf>> = {}, coverage = true) =>
  renderToString(createElement(HandoverView, { s: { ...handoverOf({}), ...over }, people, coverage, set: () => {} })).replace(/<!-- -->/g, "");

describe("the Hand-over screen", () => {
  it("names its four groups and draws labels and values, none of the explanations (they sit behind the i)", () => {
    const out = html();
    for (const title of ["Leads by themselves", "Response time", "When no team covers it", "When a lead is overdue"]) expect(out).toContain(title);
    for (const label of ["Make a lead when someone becomes Warm", "Working days to pick up a lead", "Days off", "Tell the owner", "Tell the team lead"]) expect(out).toContain(label);
    for (const text of Object.values(HANDOVER_TIPS)) expect(out, text).not.toContain(text);
    // Every explained option carries its own "?" / "i" button.
    expect(out.match(/aria-label="What &quot;[^"]+&quot; does"/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("shows the standard response time (one working day, Sunday off), the switch off, and no one on the list", () => {
    const out = html();
    expect(out).toMatch(/aria-label="Working days to pick up a lead" value="1"/);
    expect(out).toMatch(/aria-pressed="true"[^>]*>Sun</);
    expect(out).toMatch(/aria-pressed="false"[^>]*>Fri</);
    expect(out).toMatch(/aria-checked="false" aria-label="Make a lead when someone becomes Warm"/);
    expect(out).not.toContain("1. ");
  });

  it("shows the chosen settings: the rota in order with a way to remove each, only the others to add, the days, the switches", () => {
    const out = html({ fallback_user_ids: ["u2", "u1"], weekly_off: [5, 6], sla_business_days: 2, auto_create_leads: true, overdue_notify: { owner: true, team_lead: true } });
    expect(out.indexOf("1. Omar")).toBeGreaterThan(-1);
    expect(out.indexOf("1. Omar")).toBeLessThan(out.indexOf("2. Rana"));
    expect(out).toContain('aria-label="Remove Omar"');
    expect(out).toMatch(/<option value="u3">Lina<\/option>/);
    expect(out).not.toMatch(/<option value="u1">/);
    expect(out).toMatch(/value="2"/);
    expect(out).toMatch(/aria-pressed="true"[^>]*>Fri</);
    expect(out).toMatch(/aria-pressed="false"[^>]*>Sun</);
    expect(out).toMatch(/aria-checked="true" aria-label="Make a lead when someone becomes Warm"/);
    expect(out).toMatch(/aria-checked="true" aria-label="Tell the owner"/);
    expect(out).toMatch(/aria-checked="true" aria-label="Tell the team lead"/);
  });

  it("keeps the tap targets at least 44 px", () => {
    const out = html();
    expect(out).toMatch(/min-height:44px;min-width:44px/);
    expect(out).toMatch(/<select aria-label="Add a person"[^>]*min-height:44px/);
  });
});
