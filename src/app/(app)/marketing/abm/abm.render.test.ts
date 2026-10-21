import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import BuyingGroupGrid, { type GridMember } from "./[id]/accounts/[targetId]/BuyingGroupGrid";
import PlanPanel from "./[id]/accounts/[targetId]/PlanPanel";
import NewProgramForm from "./new/NewProgramForm";
import { ABM_TIPS } from "@/lib/abm/tips";

// Render smoke tests: the buying group is a table on a desktop and stacked cards on a phone (both rendered, CSS
// picks one), the explanations sit behind an "i" and are not printed, and the missing roles stay visible.

const members: GridMember[] = [
  { id: "m1", contactId: "c1", name: "Aisha Khan", jobTitle: "Procurement lead", role: "decision_maker", isPrimary: true, ownerId: "u1", lastEngagement: "12 Oct" },
  { id: "m2", contactId: "c2", name: "Omar Ali", jobTitle: null, role: "user", isPrimary: false, ownerId: null, lastEngagement: null },
];
const users = [{ id: "u1", name: "Rashid" }];
const grid = (over: Partial<Parameters<typeof BuyingGroupGrid>[0]> = {}) =>
  renderToString(createElement(BuyingGroupGrid, { targetId: "t1", accountId: "a1", members, requiredRoles: ["decision_maker", "influencer"], users, canEdit: true, ...over }));

describe("the buying group", () => {
  it("renders the table for a desktop and the stacked cards for a phone, with 44 px controls on the cards", () => {
    const out = grid();
    expect(out).toContain("bpm-rows-table");
    expect(out).toMatch(/class="bpm-rows-cards bpm-tap"/);
    expect(out.match(/aria-label="Role of Aisha Khan"/g)!.length).toBe(2);
  });
  it("puts the rules behind the card's i and does not print them", () => {
    const out = grid();
    expect(out).toContain('aria-label="About Buying group"');
    expect(out).not.toContain("Roles are for this program only");
    expect(out).not.toContain("required by this program");
  });
  it("keeps the gap on screen and marks it Required", () => {
    const out = grid().replace(/<!-- -->/g, "");
    expect(out).toContain("No influencer yet");
    expect(out).toContain(">Required<");
    expect(out).not.toContain("No decision maker yet");
  });
  it("shows no edit controls to someone who cannot edit", () => {
    const out = grid({ canEdit: false });
    expect(out).not.toContain("<select");
    expect(out).not.toContain("+ Add person");
  });
});

describe("the plan", () => {
  it("has an i on tier, owner, deal and note, and prints none of their hints", () => {
    const out = renderToString(createElement(PlanPanel, {
      targetId: "t1", accountId: "a1", users, canEdit: true,
      initial: { tier: "one_to_few", ownerId: "u1", ownerSource: "coverage", nextStep: "", nextStepDue: "", nextStepUserId: null, opportunityId: null, notes: "" },
    }));
    for (const l of ["Tier", "Owner for this program", "Deal this program is pursuing", "Private note"]) expect(out).toContain(`aria-label="About ${l}"`);
    expect(out).not.toContain(ABM_TIPS.deal);
    expect(out).not.toContain("Set from Coverage");
  });
});

describe("the new program form", () => {
  it("has an i on its six fields and no sentence under the title", () => {
    const out = renderToString(createElement(NewProgramForm, { members: [{ user_id: "u1", name: "Rashid", email: null }], groups: [], segments: [], currentUserId: "u1" }));
    for (const l of ["Kind", "Owner", "Goal", "Default tier", "Roles every company needs", "Source"]) expect(out).toContain(`aria-label="About ${l}"`);
    expect(out).not.toContain("work each one as a team");
    expect(out).not.toContain(ABM_TIPS.source);
  });
});
