import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import BondRelease from "./BondRelease";

// Releasing a bid bond cannot be undone: the button only asks, and the release is wired to the second, explicit Confirm.

const html = (initialAsking: boolean) => renderToString(createElement(BondRelease, { onConfirm: () => {}, initialAsking })).replace(/<!-- -->/g, "");

describe("releasing the bid bond", () => {
  it("first shows only the Release guarantee button, with no confirmation and no way to release yet", () => {
    const out = html(false);
    expect(out).toContain("Release guarantee");
    expect(out).not.toContain("Confirm");
    expect(out).not.toContain("This cannot be undone");
  });

  it("after the click asks inline 'Release the guarantee? This cannot be undone.' with Confirm and Cancel", () => {
    const out = html(true);
    expect(out).toContain("Release the guarantee? This cannot be undone.");
    expect(out).toContain(">Confirm<");
    expect(out).toContain(">Cancel<");
    expect(out).toContain('role="alertdialog"');
    expect(out).toMatch(/min-height:44px/);
  });

  it("the release request is made only from the confirm step, with no browser dialog", () => {
    const comp = readFileSync("src/components/tender/BondRelease.tsx", "utf8");
    expect(comp).not.toMatch(/window\.confirm|\bconfirm\(/);
    // The first button only opens the question; onConfirm is called from the Confirm button alone.
    expect(comp.match(/onConfirm\(\)/g)?.length).toBe(1);
    expect(comp).toMatch(/data-guide="tender\.bond\.confirm_yes" onClick=\{async \(\) => \{ await onConfirm\(\)/);
    expect(comp).toMatch(/data-guide="tender\.bond\.release"[^>]*onClick=\{\(\) => setAsking\(true\)\}/);
    const tab = readFileSync("src/app/(app)/pipeline/[id]/TenderOverview.tsx", "utf8");
    expect(tab).toMatch(/<BondRelease loading=\{pending\} onConfirm=\{releaseGuarantee\} \/>/);
    expect(tab).not.toMatch(/window\.confirm|confirm\(/);
    // The request itself lives in releaseGuarantee, which only the confirm step calls.
    expect(tab.match(/releaseGuarantee/g)?.length).toBe(2);
  });
});
