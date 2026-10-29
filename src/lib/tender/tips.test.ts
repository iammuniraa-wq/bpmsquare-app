import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tipTextProblems } from "@/lib/infoTip";
import { TENDER_TIPS } from "./tips";

// bpmsquarecore 6b: every explanation on a tender screen sits behind an "i" and is held to the InfoTip limit
// (two short sentences, 160 characters). The screens never print them as running text.

describe("the tender explanations", () => {
  it.each(Object.entries(TENDER_TIPS))("%s fits behind an i", (_key, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });

  it("every control of the tender screens carries a data-guide id the assistant can point at", () => {
    const root = path.resolve(__dirname, "../../..");
    const read = (p: string) => readFileSync(path.join(root, p), "utf8");
    const files = ["src/app/(app)/pipeline/PipelineTabs.tsx", "src/app/(app)/pipeline/TendersPanel.tsx", "src/app/(app)/pipeline/new/tender/NewTenderForm.tsx", "src/app/(app)/pipeline/[id]/TenderOverview.tsx", "src/app/(app)/pipeline/[id]/BidDecision.tsx", "src/components/tender/BondRelease.tsx", "src/components/tender/TenderStepper.tsx", "src/lib/tender/steps.ts", "src/app/(app)/settings/tenders/TendersSettingsClient.tsx"];
    const ids = new Set(files.flatMap((f) => [...read(f).matchAll(/"(tender\.[a-z_.]+)"/g)].map((m) => m[1])));
    for (const id of ["tender.new", "tender.field.tender_no", "tender.field.issuer", "tender.field.portal", "tender.field.closing", "tender.decision.go", "tender.decision.no_go", "tender.decision.reason", "tender.decision.save", "tender.decision.propose", "tender.decision.approve", "tender.decision.reject", "tender.decision.withdraw", "tender.bond.release", "tender.closing_soon", "tender.tab", "tender.settings", "tender.settings.approver", "tender.settings.self", "tender.steps", "tender.next", "tender.checklist", "tender.next.boq", "tender.next.unpriced", "tender.next.costing"]) {
      expect(ids, id).toContain(id);
    }
  });
});
