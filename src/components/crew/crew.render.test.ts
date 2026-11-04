import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const nav = vi.hoisted(() => ({ tab: null as string | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(nav.tab ? { tab: nav.tab } : {}),
  usePathname: () => "/ai-automation",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown; className?: string }) => createElement("a", { href: p.href, className: p.className }, p.children as never) }));

import GalleryClient from "./GalleryClient";
import AgentClient from "./AgentClient";
import ReviewList from "./ReviewList";
import RunsTable from "./RunsTable";
import TraceView, { type TraceData } from "./TraceView";
import { LOGOS } from "./logos";
import { AGENTS, COMING_SOON } from "@/lib/crew/registry";
import type { CrewView, FindingDTO, TileDTO } from "@/lib/crew/viewTypes";

// The AI automation screens render with the right things on them (a server render of the real components with sample data): a tile per agent
// from the registry, four quiet roadmap tiles that are not links, a status chip, the Pause all agents switch only for an admin, real empty
// states, and none of the explanations printed as running text. The 375 px layout comes from crew.module.css (one column under 320 px per tile,
// 44 px tap targets) and is checked in the browser.

const tile = (over: Partial<TileDTO> = {}): TileDTO => ({
  key: "tender_watch", name: "Tender Watch", purpose: "Spots tenders at risk.", logo: "tender_watch", accent: "amber", href: "/ai-automation/tender_watch",
  status: { key: "on", label: "On", tone: "ok" }, lastRunAt: "2026-11-04T05:00:00.000Z", lastRunNote: null, openFindings: 2, used: 150_000, cap: 600_000, percent: 25, ...over,
});
const view = (over: Partial<CrewView> = {}): CrewView => ({
  pending: false, isAdmin: true, workspacePaused: false, platformStopped: false, tiles: [tile()], findings: [], proposals: [], runs: [], runsVisible: true,
  settings: { tender_watch: { enabled: true, paused: false, config: {}, cap: 600_000, used: 150_000, percent: 25, digestOn: false, needsTimezone: false } }, ...over,
});
const text = (h: string) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the gallery", () => {
  it("shows a tile per available agent with its status, last run, open findings and allowance, and the four roadmap tiles quietly", () => {
    nav.tab = null;
    const html = renderToString(createElement(GalleryClient, { view: view({ tiles: [tile(), tile({ key: "attendance", name: "Attendance Anomalies", logo: "attendance", accent: "teal", href: "/ai-automation/attendance", status: { key: "needs_setup", label: "Needs setup", tone: "warn" }, openFindings: 0, lastRunAt: null }) ] }) }));
    const t = text(html);
    expect(t).toContain("Tender Watch");
    expect(t).toContain("Attendance Anomalies");
    expect(t).toContain("Needs setup");
    expect(t).toContain("Not yet");
    expect(t).toContain("150k of 600k tokens");
    expect(t).toContain("Open findings");
    for (const c of COMING_SOON) expect(t).toContain(c.name);
    expect((t.match(/Coming soon/g) ?? []).length).toBe(4);
    // Live tiles are links to the agent's page; roadmap tiles are not links.
    expect(html).toContain('href="/ai-automation/tender_watch"');
    expect(html).toContain('href="/ai-automation/attendance"');
    expect(html).not.toMatch(/href="[^"]*quote[-_]follow/i);
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(4);
  });

  it("the Pause all agents switch is for an admin only", () => {
    nav.tab = null;
    expect(text(renderToString(createElement(GalleryClient, { view: view() })))).toContain("Pause all agents");
    expect(text(renderToString(createElement(GalleryClient, { view: view({ isAdmin: false }) })))).not.toContain("Pause all agents");
    expect(renderToString(createElement(GalleryClient, { view: view({ workspacePaused: true }) }))).toContain('aria-checked="true"');
  });

  it("says a database update is needed instead of crashing when the tables are not there", () => {
    nav.tab = null;
    const t = text(renderToString(createElement(GalleryClient, { view: view({ pending: true, tiles: [tile({ status: { key: "needs_db", label: "Needs a database update", tone: "warn" } })] }) })));
    expect(t).toContain("needs a database update");
    expect(t).toContain("migration 0245");
  });

  it("opens on the Review tab with a real empty state, and shows no running explanations", () => {
    nav.tab = "review";
    const t = text(renderToString(createElement(GalleryClient, { view: view() })));
    expect(t).toContain("Nothing to review");
    expect(t).not.toMatch(/Tokens are the units/);
  });

  it("every registry logo has a component, so a tile can never render blank", () => {
    for (const a of AGENTS) expect(LOGOS[a.logo], a.key).toBeTypeOf("function");
    for (const c of COMING_SOON) expect(LOGOS[c.logo], c.key).toBeTypeOf("function");
    for (const k of Object.keys(LOGOS)) expect(renderToString(createElement(LOGOS[k as keyof typeof LOGOS], { size: 40 }))).toMatch(/^<svg[^>]*aria-hidden="true"/);
  });

  it("logos draw from tokens only: no raw colour in the SVG markup", () => {
    for (const k of Object.keys(LOGOS)) expect(renderToString(createElement(LOGOS[k as keyof typeof LOGOS], {}))).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });
});

describe("an agent's page", () => {
  const entry = AGENTS.find((a) => a.key === "tender_watch")!;
  it("has Review, Runs and Settings, and Run now for an admin when the agent is on", () => {
    nav.tab = null;
    const t = text(renderToString(createElement(AgentClient, { entry, view: view(), canDigest: true })));
    expect(t).toContain("Review");
    expect(t).toContain("Runs");
    expect(t).toContain("Settings");
    expect(t).toContain("Run now");
    expect(t).toContain("Nothing to review");
  });
  it("a member does not get Run now; the settings tab shows the allowance and the sensitivity control", () => {
    nav.tab = "settings";
    const t = text(renderToString(createElement(AgentClient, { entry, view: view({ isAdmin: false }), canDigest: true })));
    expect(t).not.toContain("Run now");
    expect(t).toContain("How sensitive");
    expect(t).toContain("150,000 of 600,000 tokens this month (25%)");
    expect(t).toContain("My daily e-mail");
  });
});

describe("the Review list and the Runs table", () => {
  const finding = (n: number): FindingDTO => ({
    id: `f${n}`, agent: "tender_watch", kind: "at_risk", severity: n === 0 ? "urgent" : "review", title: `Finding number ${n}`, body: "Body text.", evidence: [{ step: "s1", path: "x", label: "Unpriced lines", href: "/pipeline/d1" }], gaps: [],
    status: "open", createdAt: "2026-11-04T05:00:00.000Z", subjectId: "d1", href: "/pipeline/d1", runId: "r1", visual: { pricedPct: 40, daysLeft: 4, unpriced: 36, lines: 60 },
  });
  it("shows five, then Show all; the reasoning is collapsed behind Why; a small visual is drawn", () => {
    const html = renderToString(createElement(ReviewList, { findings: Array.from({ length: 7 }, (_, i) => finding(i)), proposals: [], showAgent: false, empty: { title: "Nothing" } }));
    const t = text(html);
    expect((t.match(/Finding number/g) ?? []).length).toBe(5);
    expect(t).toContain("Show all (7)");
    expect(t).toContain("Review soon");
    expect(t).toContain("24 of 60 lines priced");
    expect(html).toContain('aria-label="4 days left"');
    expect(t).not.toContain("Unpriced lines");
  });
  it("lists a note's editor only to someone who may decide", () => {
    const p = (canDecide: boolean) => [{ id: "p1", findingId: "f0", actionKey: "tender.nudge", message: "Could you chase the suppliers?", toNames: ["Faisal"], status: "pending" as const, expiresAt: "2026-11-07T00:00:00Z", canDecide }];
    expect(text(renderToString(createElement(ReviewList, { findings: [finding(0)], proposals: p(true), showAgent: false, empty: { title: "x" } })))).toContain("Edit and send");
    expect(text(renderToString(createElement(ReviewList, { findings: [finding(0)], proposals: p(false), showAgent: false, empty: { title: "x" } }))).includes("Edit and send")).toBe(false);
  });
  it("the Runs table links each run to its trace and has a real empty state", () => {
    const run = { id: "r1", agent: "tender_watch" as const, agentName: "Tender Watch", trigger: "schedule" as const, because: "Daily pass", status: "done" as const, at: "2026-11-04T05:00:00.000Z", tokens: 16050, findings: 2, proposals: 1, note: null, error: null };
    const html = renderToString(createElement(RunsTable, { runs: [run], showAgent: true }));
    expect(html).toContain('href="/ai-automation/tender_watch/runs/r1"');
    expect(text(html)).toContain("2 suggestions, 1 note drafted");
    expect(text(html)).toContain("16,050");
    expect(text(renderToString(createElement(RunsTable, { runs: [], showAgent: false })))).toContain("No runs yet");
  });
  it("the trace has the four sections and a quiet pass reads as such", () => {
    nav.tab = null;
    const trace: TraceData = {
      agent: "tender_watch", agentName: "Tender Watch", accent: "amber", trigger: "schedule", because: "Daily pass. Nothing to report. 7 live tenders checked", status: "done", model: null, promptVersion: null,
      queuedAt: "2026-11-04T05:00:00Z", startedAt: null, finishedAt: null, tokensIn: 0, tokensOut: 0, percentOfCap: 0, error: null, note: "Nothing to report. 7 live tenders checked",
      steps: [], concluded: [], proposed: [], left: [], isAdmin: true,
    };
    const t = text(renderToString(createElement(TraceView, { t: trace })));
    for (const s of ["Looked at", "Concluded", "Proposed", "Could not check / left out", "Nothing was read: this was a quiet pass."]) expect(t).toContain(s);
  });
});
