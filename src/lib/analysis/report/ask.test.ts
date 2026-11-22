import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canOfferReportRow, reportPhrase } from "./ask";
import { AI_DOCK_ASK_EVENT, askDock } from "../dockAsk";

// The ⌘K side: the row appears only for the phrases that mean "tell me about this company" and only where the dock itself
// would be offered, and choosing it hands a prepared question to the dock. The palette owns nothing else.

describe("the phrases", () => {
  it.each([
    ["analyse Najd Precast", "Najd Precast"],
    ["analyze the company Najd Precast Co.", "Najd Precast Co"],
    ["Analyse Tesla Germany?", "Tesla Germany"],
    ["research Najd Precast", "Najd Precast"],
    ["research on Najd Precast", "Najd Precast"],
    ["competitor Rival Pumps", "Rival Pumps"],
    ["competitor analysis of Rival Pumps", "Rival Pumps"],
    ["competitor: Rival Pumps", "Rival Pumps"],
    ["company report on Najd Precast", "Najd Precast"],
    ["Company report for Najd Precast", "Najd Precast"],
    ["background on Najd Precast", "Najd Precast"],
  ])("%s -> %s", (typed, subject) => {
    const p = reportPhrase(typed);
    expect(p?.subject).toBe(subject);
    expect(p?.question).toBe(`Company report on ${subject}`);
  });

  it.each([
    "najd precast", "accounts", "new quote", "open inbox", "reanalyse Najd", "analyse", "research ", "background", "company report",
    "prep me for my call with Najd", "analysing Najd Precast",
  ])("%s is not a research phrase", (typed) => {
    expect(reportPhrase(typed)).toBeNull();
  });

  it("an e-mail address, a phone number or a pasted paragraph is never a company", () => {
    expect(reportPhrase("research jane@gmail.com")).toBeNull();
    expect(reportPhrase("analyse +966 50 123 4567")).toBeNull();
    expect(reportPhrase("research Najd Precast\nand also their phone")).toBeNull();
    expect(reportPhrase(`research ${"x".repeat(300)}`)).toBeNull();
  });
});

describe("who is offered the row", () => {
  const on = { ai_assistant: true, ai_assistant_web: true, accounts: true };
  const offer = (o: Partial<Parameters<typeof canOfferReportRow>[0]> = {}) => canOfferReportRow({ features: on, config: {}, viewable: "all", ...o });

  it("the assistant, its web research and the Accounts module on, nothing blocking", () => expect(offer()).toBe(true));
  it("a person with the Accounts workcenter", () => expect(offer({ viewable: ["accounts", "quotations"] })).toBe(true));
  it.each([
    ["the assistant off", { features: { ...on, ai_assistant: false } }],
    ["web research off", { features: { ...on, ai_assistant_web: false } }],
    ["web research missing", { features: { ai_assistant: true, accounts: true } }],
    ["the Accounts module off", { features: { ...on, accounts: false } }],
    ["no Accounts workcenter", { viewable: ["quotations"] }],
    ["the workspace blocking outside calls", { config: { ai_assistant: { block_external_calls: true } } }],
    ["no tenant yet", { features: null }],
  ])("not with %s", (_n, o) => expect(offer(o as never)).toBe(false));
});

describe("choosing the row", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("raises one dock event with the prepared question and no account", () => {
    const seen: CustomEvent[] = [];
    vi.stubGlobal("window", { dispatchEvent: (e: CustomEvent) => { seen.push(e); return true; } });
    const p = reportPhrase("research Najd Precast")!;
    askDock(p.question, null);
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe(AI_DOCK_ASK_EVENT);
    expect(seen[0].detail).toEqual({ question: "Company report on Najd Precast", accountId: null });
  });

  it("the palette wires exactly that: the gate, the phrase, and askDock with the prepared question", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../components/NovaPalette.tsx"), "utf8");
    expect(src).toContain('import { askDock } from "@/lib/analysis/dockAsk"');
    expect(src).toMatch(/canOfferReportRow\(\{ features, config: tenant\?\.config, viewable \}\) \? reportPhrase\(query\) : null/);
    expect(src).toMatch(/item\.kind === "ask"[\s\S]{0,80}askDock\(item\.question, null\)/);
    expect(src).toContain('ask: "Ask the assistant"');
    // The palette searches nothing and consents to nothing itself.
    expect(src).not.toMatch(/allow_web|consent_token|\/api\/ai\//);
  });
});
