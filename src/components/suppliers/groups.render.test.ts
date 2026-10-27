import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/suppliers/groups",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import GroupsClient from "./GroupsClient";
import SupplierPicker from "@/components/rfq/SupplierPicker";
import { GROUP_TIPS } from "./tips";
import { RFQ_TIPS } from "@/lib/rfq/tips";
import type { SupplierGroup } from "./groupsApi";

// The supplier Groups view and the composer's approved-list note render, with the right words and none of their explanations printed (6b).
// 375 px and PC share one markup: a table and a card stack (CSS picks one at 780 px), the panel is the shared SidePanel (a bottom sheet on a
// phone), every action is a 44 px target, the member list is paged, and no colour is written by hand.

const ROOT = path.resolve(__dirname, "../../..");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const src = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const controls = (html: string) => [...html.matchAll(/<(?:button|a)\b[^>]*class="[^"]*bpm-btn[^"]*"[^>]*>(?:[^<]*)/g)].map((m) => m[0]).filter((t) => !/>Close$/.test(t));

const suppliers = [
  { id: "s1", name: "SAMPLE Gulf Pipes LLC", type: "vendor", city: "Dammam", status: "active" },
  { id: "s2", name: "Precast Arabia", type: "both", city: null, status: "active" },
  { id: "s3", name: "Retired Co.", type: "vendor", city: null, status: "inactive" },
];
const accounts = [{ id: "a1", name: "Red Sea Construction Group" }, { id: "a2", name: "Aramco" }];
const groups: SupplierGroup[] = [
  { id: "g1", name: "Red Sea approved vendors", account_id: "a1", member_count: 14 },
  { id: "g2", name: "Aramco approved vendors", account_id: "a2", account_name: "Aramco Services", member_count: 3 },
  { id: "g3", name: "Loose list", account_id: null },
];
const view = (props: Partial<Parameters<typeof GroupsClient>[0]> = {}) =>
  clean(renderToString(createElement(GroupsClient, { suppliers, accounts, canEdit: true, initialGroups: groups, ...props })));

describe("the Groups view", () => {
  const out = view();

  it("is one table: the group, its client and its member count", () => {
    expect(out).toContain('data-guide="supplier.groups.table"');
    for (const h of ["Group", "Client", "Members"]) expect(out, h).toContain(`>${h}</th>`);
    expect(out).toContain("Red Sea approved vendors");
    expect(out).toContain("Red Sea Construction Group");
    expect(out).toContain(">14<");
    expect(out).toContain("Aramco Services");
    expect(out).toContain("—");
    expect(out.match(/<table/g)).toHaveLength(1);
  });

  it("a phone gets a card per group from the same markup, and the table scrolls inside its own container", () => {
    expect(out).toContain('class="bpm-rows-table"');
    expect(out).toContain('class="bpm-rows-cards"');
    expect(out.match(/data-guide="supplier.group.card"/g)).toHaveLength(3);
    expect(out).toContain("overflow-x:auto");
    expect(out).toContain("14 members");
  });

  it("prints none of its explanations, they sit behind the i", () => {
    for (const tip of Object.values(GROUP_TIPS)) expect(out).not.toContain(tip);
    expect(out).toContain("About Groups");
  });

  it("every action is a 44 px target; + New group is for someone who can edit", () => {
    for (const t of controls(out)) expect(t, t).toContain("min-height:44px");
    expect(out).toContain('data-guide="supplier.group.new"');
    expect(view({ canEdit: false })).not.toContain('data-guide="supplier.group.new"');
  });

  it("an empty list says what to do next, and a long list is paged", () => {
    expect(view({ initialGroups: [] })).toContain("No groups yet");
    const many: SupplierGroup[] = Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, name: `Group ${i + 1}`, account_id: null }));
    const long = view({ initialGroups: many });
    expect(long).toContain("Show all 12");
    expect(long).toContain("Group 10");
    expect(long).not.toContain("Group 11");
  });
});

describe("the group panel", () => {
  it("a new group asks for a name, a client and the members to tick, and saves in the footer", () => {
    const out = view({ initialPanel: {} });
    expect(out).toContain('role="dialog"');
    expect(out).toContain('data-guide="supplier.group.panel"');
    for (const g of ["supplier.group.field.name", "supplier.group.field.client", "supplier.group.members", "supplier.group.save"]) expect(out, g).toContain(`data-guide="${g}"`);
    expect(out).toContain("New group");
    expect(out).toContain("— No client —");
    expect(out.match(/data-guide="supplier.group.member"/g)).toHaveLength(2);
    expect(out).toContain("SAMPLE Gulf Pipes LLC");
    expect(out).not.toContain("Retired Co.");
    expect(out).not.toContain('data-guide="supplier.group.delete"');
    expect(out).toMatch(/<button[^>]*data-guide="supplier.group.save"[^>]*disabled/);
  });

  it("an existing group shows its members ticked, can be deleted after a confirm, and a client that already has another group cannot be picked", () => {
    const out = view({ initialPanel: { id: "g1", members: ["s1"] } });
    expect(out).toContain("Red Sea approved vendors");
    expect(out).toContain("1 member");
    expect(out).toMatch(/<input type="checkbox"[^>]*checked/);
    expect(out).toContain('data-guide="supplier.group.delete"');
    expect(out).toContain("Aramco (has a group)");
    expect(out).not.toContain("Red Sea Construction Group (has a group)");
    expect(out).not.toMatch(/<button[^>]*data-guide="supplier.group.save"[^>]*disabled/);
  });

  it("a view-only person sees the members but cannot change them", () => {
    const out = view({ canEdit: false, initialPanel: { id: "g1", members: ["s1"] } });
    expect(out).not.toContain('data-guide="supplier.group.save"');
    expect(out).not.toContain('data-guide="supplier.group.delete"');
    expect(out).toMatch(/<input type="checkbox"[^>]*disabled/);
  });

  it("the panel is the shared side panel and every control is 44 px", () => {
    const out = view({ initialPanel: { id: "g1", members: [] } });
    for (const t of controls(out)) expect(t, t).toContain("min-height:44px");
    expect(src("src/components/suppliers/GroupsClient.tsx")).toContain("SidePanel");
  });

  it("a long supplier list is searchable and paged", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, name: `Supplier ${i + 1}`, type: "vendor", city: null, status: "active" }));
    const out = view({ suppliers: many, initialPanel: {} });
    expect(out).toContain('aria-label="Search suppliers"');
    expect(out).toContain("Show all 20");
    expect(out).toContain("Supplier 12");
    expect(out).not.toContain("Supplier 13");
  });
});

describe("the page and the entry point", () => {
  it("the page is for the tender edition only, behind the suppliers workcenter, with the Suppliers and Groups tab strip", () => {
    const page = src("src/app/(app)/suppliers/groups/page.tsx");
    expect(page).toContain('requireWorkcenterView("suppliers")');
    expect(page).toContain('requireFeature("suppliers")');
    expect(page).toContain("gcc_tender !== true) notFound()");
    expect(page).toContain('.eq("tenant_id", tenantId)');
    expect(page).toContain("hrefFor");
  });

  it("the Suppliers list links to it from a Groups chip, only where the tender edition is on", () => {
    const list = src("src/app/(app)/suppliers/page.tsx");
    expect(list).toContain('if (tenant?.features?.gcc_tender === true) chips.push({ id: "groups"');
    expect(src("src/lib/constants.ts")).toContain('supplierGroups: "/suppliers/groups"');
  });
});

describe("the composer's approved-list note", () => {
  const picker = (scope: Parameters<typeof SupplierPicker>[0]["scope"]) => clean(renderToString(createElement(SupplierPicker, {
    suppliers: [{ id: "s1", name: "A", email: "a@x.com", city: null, status: "active" }], chosen: [], onToggle: () => {}, suggested: [], current: [], scope,
  })));

  it("names the group when the deal's client has one", () => {
    const out = picker({ restricted: true, group: "Red Sea approved vendors" });
    expect(out).toContain('data-guide="rfq.suppliers.scope"');
    expect(out).toContain("Suppliers from:");
    expect(out).toContain("Red Sea approved vendors");
    expect(out).not.toContain(RFQ_TIPS.approvedList);
    expect(out).toContain("About Approved suppliers");
  });

  it("falls back to the client's approved list when the route does not name it", () => {
    expect(picker({ restricted: true, group: null })).toContain("the client&#x27;s approved list");
  });

  it("says, quietly, when the client has no approved list", () => {
    const out = picker({ restricted: false, group: null });
    expect(out).toContain("No approved list for this client");
    expect(out).not.toContain("Suppliers from:");
  });

  it("shows nothing at all where no source is given (every standard RFQ form)", () => {
    expect(picker(null)).not.toContain("rfq.suppliers.scope");
    expect(picker(undefined)).not.toContain("approved list");
  });
});
