import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import {
  REPORT_CONSENT_PREFIX, REPORT_PROMPT_RULE, REPORT_TOOL_NAME, WEB_OFF_REASON_TEXT, decodeReportQuery, encodeReportQuery, parseReportInput,
  reportNoticeText, reportSearchesText, reportTool, webOffPromptLine,
} from "./reportTool";
import { ANALYSIS_CONSENT_PREFIX } from "./analysisTool";
import { MAX_REPORT_SEARCHES } from "@/lib/analysis/report/types";

const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

describe("what the model may pass", () => {
  it("only the named fields, each cleaned and clipped; ids must be ids", () => {
    const i = parseReportInput({ account_id: ACC.toUpperCase(), lead_id: "x", name: "  Najd | <b>Precast</b> ", domain: "d".repeat(200), country: 5, refresh: "yes", tenant_id: "t-2", query: "anything" });
    expect(i).toEqual({ accountId: ACC, leadId: null, name: "Najd b Precast /b", domain: "d".repeat(80), country: null, refresh: false });
  });
  it("nothing at all is an empty subject", () => {
    expect(parseReportInput(null)).toEqual({ accountId: null, leadId: null, name: null, domain: null, country: null, refresh: false });
  });
});

describe("the signed subject", () => {
  it("has a prefix of its own, so no other kind of consent can stand in for it", () => {
    expect(REPORT_CONSENT_PREFIX).not.toBe(ANALYSIS_CONSENT_PREFIX);
    expect(encodeReportQuery(parseReportInput({ name: "X Co" })).startsWith(REPORT_CONSENT_PREFIX)).toBe(true);
    expect(decodeReportQuery(encodeReportQuery(parseReportInput({ name: "X Co" })).replace(REPORT_CONSENT_PREFIX, ANALYSIS_CONSENT_PREFIX))).toBeNull();
  });
  it("a subject with the wrong number of parts or a bad id is refused", () => {
    expect(decodeReportQuery("research_report|a|b")).toBeNull();
    expect(decodeReportQuery(`research_report|${ACC}|bad||||`)).toBeNull();
    expect(decodeReportQuery(42)).toBeNull();
  });
  it("a '|' typed into a name cannot add a part", () => {
    const i = parseReportInput({ name: "A|B" });
    expect(decodeReportQuery(encodeReportQuery(i))).toEqual(i);
  });
});

describe("the tool and its rule", () => {
  it("is named once and says when to use it and when not to", () => {
    expect(reportTool().name).toBe(REPORT_TOOL_NAME);
    expect(reportTool().description).toMatch(/analyse_company instead/);
    expect(REPORT_PROMPT_RULE).toContain("research_company_report");
    expect(REPORT_PROMPT_RULE).toContain("'Analyse X' alone");
    expect(REPORT_PROMPT_RULE).toContain("inference");
  });
});

describe("when web research is off", () => {
  it("every reason has plain words", () => {
    for (const k of Object.keys(WEB_OFF_REASON_TEXT) as (keyof typeof WEB_OFF_REASON_TEXT)[]) {
      const line = webOffPromptLine(k);
      expect(line).toContain(WEB_OFF_REASON_TEXT[k]);
      expect(line).toContain("switched off");
    }
  });
});

describe("notices", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it("say what happened in a sentence", () => {
    expect(reportNoticeText({ kind: "daily_limit" }, now)).toContain("daily limit");
    expect(reportNoticeText({ kind: "over_budget" }, now)).toContain("allowance");
    expect(reportNoticeText({ kind: "refresh_limit", until: "2026-10-21T12:25:00Z" }, now)).toContain("about 25 minutes");
    expect(reportNoticeText({ kind: "refresh_limit", until: "2026-10-21T12:00:30Z" }, now)).toContain("about 1 minute.");
    expect(reportNoticeText({ kind: "research_failed", message: "The research took too long." }, now)).toBe("The research took too long. This is the saved report.");
  });
  it("quote the number of searches the chip and the explanation share", () => {
    expect(reportSearchesText()).toBe(`up to ${MAX_REPORT_SEARCHES} searches`);
    for (const n of [{ kind: "daily_limit" as const }, { kind: "over_budget" as const }]) expect(tipTextProblems(reportNoticeText(n, now)).filter((p) => p.includes("sentences"))).toEqual([]);
  });
});
