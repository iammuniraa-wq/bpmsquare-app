import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { NAV, ROUTES } from "@/lib/constants";
import { SETTINGS_MENU } from "@/lib/settingsMenu";
import { WORKCENTERS } from "@/lib/workcenters";
import Tour from "@/components/marketing/Tour";

// One word, one thing (docs/design/settings-simplification-marketing.md section 3b): the names a person sees
// in the menu are the names the audit settled on. Routes, ids and feature keys do not change with a name.

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const leaves = NAV.flatMap((g) => g.items.flatMap((i) => (i.children?.length ? i.children : [i])));

describe("marketing names", () => {
  it("scored leads are a view of Leads: one menu row, no second list", () => {
    expect(leaves.filter((l) => l.label === "Leads").map((l) => l.href)).toEqual([ROUTES.leads]);
    expect(leaves.some((l) => l.label === "Scored leads" || l.label === "Lead scores")).toBe(false);
    expect(ROUTES.marketingLeads).toBe("/leads?view=scored");
  });

  it("the attribution page is Results in the menu and the workcenter list (its page title stays Revenue by source)", () => {
    expect(leaves.find((l) => l.href === ROUTES.marketingAttribution)?.label).toBe("Results");
    expect(WORKCENTERS.find((w) => w.key === "marketing_attribution")?.label).toBe("Results");
  });

  it("the audience page is Audiences in the menu and the workcenter list", () => {
    expect(leaves.find((l) => l.href === ROUTES.marketingSegments)?.label).toBe("Audiences");
    expect(WORKCENTERS.find((w) => w.key === "marketing_segments")?.label).toBe("Audiences");
  });

  it("the consent page has one name in Settings", () => {
    const entry = SETTINGS_MENU.find((e) => e.href === ROUTES.settingsMarketingConsent)!;
    expect(entry.label).toBe("Consent");
    expect(entry.featureAnyOf).toEqual(["marketing", "marketing_scoring", "newsletter_studio"]);
  });
});

describe("the shared Tour", () => {
  it("renders only its closed button, with the id a studio asks for", () => {
    const out = renderToString(createElement(Tour, { steps: [{ target: "x", text: "One" }], storageKey: "bpm.test.tour.step", buttonId: "tstTourBtn" }));
    expect(out).toContain('id="tstTourBtn"');
    expect(out).toContain("Show me how");
    expect(out).not.toContain('role="dialog"');
  });
});

describe("Marketing and Intelligence are two parts (docs/design/marketing-two-parts.md)", () => {
  const rows = (group: string) => NAV.find((g) => g.group === group)!.items.flatMap((i) => i.children ?? []);
  const keys = (group: string) => rows(group).map((r) => r.workcenterKey).sort();

  it("Marketing reaches people, Intelligence knows who is ready", () => {
    expect(rows("MARKETING").map((r) => r.label)).toEqual(["Overview", "Audiences", "Email", "Journeys", "Forms", "WhatsApp", "Events"]);
    expect(rows("INTELLIGENCE").map((r) => r.label)).toEqual(["Overview", "Buying signals", "Leads", "ABM programs", "Results"]);
  });

  it("every marketing destination is in exactly one part, with its flag and workcenter key unchanged", () => {
    const all = [...rows("MARKETING"), ...rows("INTELLIGENCE")];
    expect(new Set(all.map((r) => r.href)).size).toBe(all.length);
    expect(all.every((r) => (r.featureKey || r.featureAnyOf?.length) && (r.workcenterKey || r.workcenterAnyOf?.length))).toBe(true);
    expect(keys("MARKETING")).toEqual(["marketing", "marketing", "marketing_events", "marketing_forms", "marketing_journeys", "marketing_segments", "marketing_whatsapp"]);
    expect(keys("INTELLIGENCE").filter(Boolean)).toEqual(["abm", "leads", "marketing_attribution", "signals"]);
  });
});
