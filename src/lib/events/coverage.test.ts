import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EVENTS } from "./catalog";

// The catalogue says what the product can announce; this keeps it honest. Every name in it is either emitted
// by some source file (EVENTS.NAME used outside the catalogue and tests) or listed here with the reason it is
// not, so a new catalogued event cannot sit unemitted without someone saying why.

const NOT_EMITTED: Record<string, string> = {
  QUOTE_UPDATED: "every save would fire it; quote.status_changed and quote.outcome_changed carry the meaningful changes",
  QUOTE_PRICED: "pricing is per line and high volume; wants a decision on one event per quote or per line",
  QUOTE_OPENED: "needs open tracking on the public quote link; link-preview bots would also fire it and inflate lead scores",
  QUOTE_CHANGE_REQUESTED: "there is no change-request action on the customer link yet",
  PRICING_VERSION_PUBLISHED: "no publish action on pricing versions to hang it on",
  PRICING_RFQ_REPLIED: "the legacy pricing reply; superseded by rfq.replied",
  CONTRACT_EXPIRING: "needs a daily cron that scans contract end dates",
  CONTRACT_RENEWED: "there is no renewal action on contracts yet",
  EMAIL_INTEREST: "the campaign interest link would start moving lead scores (30 points) for live workspaces; owner decision",
  WEB_PAGE_VIEWED: "needs the website tracker",
  WEB_IDENTIFIED: "needs the website tracker",
  SIGNAL_DETECTED: "the signals design has not shipped a detector that fires it",
  WFM_LEAVE_REQUESTED: "planned for the WFM event bus; no consumer yet",
  WFM_OT_REQUESTED: "planned for the WFM event bus; no consumer yet",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && entry.name !== "catalog.ts") out.push(p);
  }
  return out;
}

const root = path.resolve(__dirname, "..", "..");
const used = new Set<string>();
for (const file of sourceFiles(root)) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/EVENTS\.([A-Z0-9_]+)/g)) used.add(m[1]);
}

describe("event catalogue coverage", () => {
  it("every catalogued event is emitted somewhere or explained in NOT_EMITTED", () => {
    const missing = Object.keys(EVENTS).filter((k) => !used.has(k) && !(k in NOT_EMITTED));
    expect(missing).toEqual([]);
  });

  it("NOT_EMITTED names real events and none of them is in fact emitted now (so the list shrinks as events get wired)", () => {
    for (const k of Object.keys(NOT_EMITTED)) {
      expect(Object.keys(EVENTS)).toContain(k);
      expect(used.has(k)).toBe(false);
    }
  });

  it("the events this piece of work wired are emitted", () => {
    for (const k of ["QUOTE_ACCEPTED", "QUOTE_CREATED", "QUOTE_REVISED", "QUOTE_OUTCOME_CHANGED", "WORK_ORDER_COMPLETED", "RFQ_SENT", "RFQ_REPLIED", "RFQ_AWARDED", "OPPORTUNITY_UPDATED", "ORDER_CREATED", "ORDER_CONFIRMED", "ORDER_CANCELLED", "ORDER_SENT"]) {
      expect(used.has(k), k).toBe(true);
    }
  });
});
