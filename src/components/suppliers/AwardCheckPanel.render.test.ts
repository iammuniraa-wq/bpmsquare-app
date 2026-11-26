import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AwardCheckPanel, type AwardGate } from "./AwardCheckPanel";
import { gateBody, gateReady, type AwardCheck } from "@/lib/suppliers/check/awardGate";
import { CHECK_TIPS } from "@/lib/suppliers/check/tips";
import { tipTextProblems } from "@/lib/infoTip";

// The warning before an award to a flagged supplier: amber text with the strongest two findings and a link to the check, a required reason,
// a tick for "Concerning" only, the explanation behind the "i" and not printed, and 44 px controls. The award button of each dialog is
// enabled by gate.ready, which is asserted here from the same function the server uses.

const S = "5a000000-0000-4000-8000-000000000001";
const check = (verdict: AwardCheck["verdict"], over: Partial<AwardCheck> = {}): AwardCheck => ({ supplierId: S, name: "Gulf Skirting", verdict, findings: ["Shares a bank account with Other Co", "No tax number on file"], checkedAt: "2026-11-20T00:00:00Z", ...over });

const gate = (checks: AwardCheck[], over: Partial<AwardGate> = {}): AwardGate => {
  const reason = over.reason ?? "";
  const ack = over.ack ?? false;
  return { checks, askedIds: checks.map((c) => c.supplierId), loaded: true, reason, setReason: () => {}, ack, setAck: () => {}, ready: gateReady(checks, reason, ack), body: gateBody(reason, ack, checks.some((c) => c.verdict === "check_first" || c.verdict === "concerning")), ...over };
};
const html = (g: AwardGate) => renderToString(createElement(AwardCheckPanel, { gate: g })).replace(/<!-- -->/g, "");

describe("the award warning panel", () => {
  it("check first: amber alert, 'This supplier is marked Check first', the top two findings, a link to the Supplier check tab", () => {
    const o = html(gate([check("check_first")]));
    expect(o).toContain('role="alert"');
    expect(o).toContain("var(--amberbg)");
    expect(o).toContain("This supplier</b> is marked <b>Check first</b> in your Supplier check: Shares a bank account with Other Co. No tax number on file.");
    expect(o).toContain(`href="/suppliers/${S}?tab=check"`);
    expect(o).toContain("Open the check");
    expect(o).toContain("Reason for awarding anyway");
    expect(o).not.toContain("I have reviewed the findings");
  });

  it("concerning: the same, plus the tick", () => {
    const o = html(gate([check("concerning")]));
    expect(o).toContain("is marked <b>Concerning</b>");
    expect(o).toContain("I have reviewed the findings");
  });

  it("the award stays disabled until the reason (and for concerning the tick) are filled", () => {
    const fs = [check("check_first")];
    const cn = [check("concerning")];
    expect(gate(fs).ready).toBe(false);
    expect(gate(fs, { reason: "abcd" }).ready).toBe(false);
    expect(gate(fs, { reason: "Only one in stock" }).ready).toBe(true);
    expect(gate(cn, { reason: "Only one in stock" }).ready).toBe(false);
    expect(gate(cn, { reason: "Only one in stock", ack: true }).ready).toBe(true);
    expect(gate(cn, { reason: "Only one in stock", ack: true }).body).toEqual({ supplier_check_reason: "Only one in stock", supplier_check_ack: true });
  });

  it("looks genuine and unchecked suppliers get no warning, at most the small neutral line", () => {
    expect(html(gate([check("looks_genuine")]))).not.toContain("role=\"alert\"");
    const none = html(gate([], { askedIds: [S] }));
    expect(none).toContain("Not verified yet");
    expect(none).not.toContain("amberbg");
    expect(html(gate([check("unverified")]))).toContain("Not verified yet");
    expect(html(gate([], { askedIds: [] }))).toBe("");
  });

  it("while the check is still loading it draws nothing", () => {
    expect(html(gate([], { loaded: false }))).toBe("");
  });

  it("the explanation is behind the 'i', never printed, and fits the limit", () => {
    const o = html(gate([check("check_first")]));
    expect(o).not.toContain(CHECK_TIPS.awardWarning);
    expect(tipTextProblems(CHECK_TIPS.awardWarning)).toEqual([]);
  });

  it("phone width: 44 px controls, wrapping text, guide ids", () => {
    const o = html(gate([check("concerning")]));
    expect(o).toContain("min-height:44px");
    expect(o).toContain("overflow-wrap:anywhere");
    for (const id of ["award.check.warning", "award.check.reason", "award.check.ack", "award.check.open"]) expect(o).toContain(`data-guide="${id}"`);
  });

  it("two flagged suppliers are named", () => {
    const o = html(gate([check("check_first"), check("concerning", { supplierId: "5a000000-0000-4000-8000-000000000002", name: "Desert Supply" })]));
    expect(o).toContain("Gulf Skirting</b> is marked");
    expect(o).toContain("Desert Supply</b> is marked");
  });
});
