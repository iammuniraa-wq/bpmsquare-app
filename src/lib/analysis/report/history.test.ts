import { describe, expect, it } from "vitest";
import { buildBriefHistory, contactGapsFor, functionOfTitle } from "./history";
import { askDockForBrief, briefQuestion, AI_DOCK_ASK_EVENT } from "../dockAsk";
import { vi } from "vitest";

// "Your history with them": the workspace's own contacts and records mapped to the buying functions a brief names. Plain titles in,
// plain counts out; nothing here can reach the web or the cache.

describe("which buying function a title points at", () => {
  it.each([
    ["Chief Procurement Officer", "procurement"], ["Purchasing manager", "procurement"], ["Supply chain lead", "procurement"],
    ["Chief Financial Officer", "finance"], ["Accounts payable clerk", "finance"],
    ["Chief Executive Officer", "executive"], ["Managing Director", "executive"], ["Founder", "executive"],
    ["Director of Projects", "projects"], ["Site manager", "projects"], ["Construction lead", "projects"],
    ["Plant manager", "operations"], ["Yard supervisor", "operations"], ["Maintenance engineer", "operations"],
  ])("%s is %s", (title, fn) => expect(functionOfTitle(title)).toBe(fn));

  it("a title that points at nothing is no function, and an empty one is none", () => {
    expect(functionOfTitle("Receptionist")).toBeNull();
    expect(functionOfTitle(null, undefined, "")).toBeNull();
  });
  it("the department counts when the title is silent", () => expect(functionOfTitle(null, "Procurement")).toBe("procurement"));
});

const raw = (over: Record<string, unknown> = {}) => ({
  account: { id: "a1", name: "Halcyon", type: null, owner: null, createdAt: null },
  contacts: [{ id: "1", name: "A", title: "Purchasing manager", department: null }, { id: "2", name: "B", title: "Buyer", department: null }, { id: "3", name: "C", title: "Receptionist", department: null }],
  quotes: [], deals: [], cases: [], invoices: [], lastActivity: null, accountNames: null,
  subject: { name: "Halcyon", domain: null }, now: new Date("2026-11-23T00:00:00Z"), formatValue: (n: number) => String(n), ...over,
}) as never;

describe("the history of one company", () => {
  const h = buildBriefHistory(raw());
  it("counts contacts by function and keeps the first of each", () => {
    expect(h.contactCount).toBe(3);
    expect(h.byFunction.procurement).toEqual({ count: 2, first: { name: "A", title: "Purchasing manager" } });
    expect(h.byFunction.finance).toBeUndefined();
  });
  it("names the functions the brief has but the workspace holds no contact in", () => {
    expect(contactGapsFor(h, ["procurement", "finance", "executive"])).toEqual(["finance", "executive"]);
    expect(contactGapsFor({ ...h, contactCount: null }, ["finance"])).toEqual([]);
    expect(contactGapsFor({ ...h, inCrm: false }, ["finance"])).toEqual([]);
  });
  it("a person who may not view contacts is not told anything about them", () => {
    const hidden = buildBriefHistory(raw({ contacts: null }));
    expect(hidden.contactCount).toBeNull();
    expect(hidden.byFunction).toEqual({});
  });
  it("a company with no account is not in the CRM and carries similar names", () => {
    const x = buildBriefHistory(raw({ account: null, contacts: null, accountNames: [{ id: "z", name: "Halcyon Group", website: null }] }));
    expect(x.inCrm).toBe(false);
    expect(x.similar.map((s) => s.name)).toEqual(["Halcyon Group"]);
    expect(x.href).toBeNull();
  });
});

describe("asking the slider for a brief from a screen", () => {
  it("raises one event with the question and, for an account, the brief request itself (so no model is asked)", () => {
    const seen: unknown[] = [];
    const win = { dispatchEvent: (e: CustomEvent) => { seen.push(e.detail); return true; } };
    vi.stubGlobal("window", win);
    vi.stubGlobal("CustomEvent", class { detail: unknown; constructor(public type: string, init: { detail: unknown }) { this.detail = init.detail; } });
    askDockForBrief("Halcyon Gulf", "a1");
    askDockForBrief("Halcyon Gulf", "a1", { retry: true });
    askDockForBrief("Halcyon Gulf", "a1", { refresh: true });
    askDockForBrief("Typed Co", null);
    vi.unstubAllGlobals();
    expect(seen).toEqual([
      { question: "Company report on Halcyon Gulf", accountId: "a1", report: { account_id: "a1" } },
      { question: "Try the missing parts of the brief on Halcyon Gulf", accountId: "a1", report: { account_id: "a1", retry: true } },
      { question: "Refresh the report on Halcyon Gulf", accountId: "a1", report: { account_id: "a1", refresh: true } },
      { question: "Company report on Typed Co", accountId: null },
    ]);
    expect(AI_DOCK_ASK_EVENT).toBe("bpm:ai-dock-ask");
    expect(briefQuestion("  Najd   Precast ")).toBe("Company report on Najd Precast");
  });
});
