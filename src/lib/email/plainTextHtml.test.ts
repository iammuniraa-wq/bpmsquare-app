import { describe, expect, it } from "vitest";
import { plainTextToHtml } from "./plainTextHtml";

const APPROVAL = [
  "Redirected by the workspace's email output setting. Intended recipients: a@x.com, b@y.com",
  "",
  "---",
  "",
  "sap asks you to approve the baseline budget of the contract project \"CPR-0002 TEST tender – Reservoir pipework\".",
  "Request: Baseline budget, SAR 712,920",
  "Review and decide: https://kamco.bpmsquare.com/contract-projects/12a123d8-6511-406f-9717-9149eae0e05b",
  "You are receiving this because you can approve project budgets in this workspace.",
].join("\n");

describe("plainTextToHtml", () => {
  it("turns the approval link into a button with the full address", () => {
    const html = plainTextToHtml(APPROVAL);
    expect(html).toContain('<a href="https://kamco.bpmsquare.com/contract-projects/12a123d8-6511-406f-9717-9149eae0e05b" style="display:inline-block');
    expect(html).toContain(">Review and decide</a>");
    expect(html).toContain("Request: Baseline budget, SAR 712,920");
    expect(html).toContain("<hr");
  });

  it("links a URL inside a sentence and drops trailing punctuation from it", () => {
    const html = plainTextToHtml("Open it at https://a.example/x/1. Thanks");
    expect(html).toContain('<a href="https://a.example/x/1" style="color:#1f4e8c;">https://a.example/x/1</a>. Thanks');
  });

  it("draws a bare link line as a button", () => {
    expect(plainTextToHtml("A note\n\nhttps://a.example/pipeline/9")).toContain(">Open in BPMSquare</a>");
  });

  it("escapes markup typed by a person", () => {
    const html = plainTextToHtml('Reason: <script>alert(1)</script> & "x"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never makes a non-http address a link", () => {
    expect(plainTextToHtml("Go: javascript:alert(1)")).not.toContain("href");
  });
});
