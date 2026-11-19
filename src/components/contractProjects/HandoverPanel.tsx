import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { c } from "@/lib/theme";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { BUYOUT_TIPS } from "./buyout/tips";
import HandoverPackages from "./buyout/HandoverPackages";
import type { BuyoutData } from "./buyout/types";

/**
 * The "ERP handover" tab: everything that leaves for the ERP, in two named parts. Budget is the project's budget file; Packages lists the
 * order file of each awarded buy-out package (the package itself is marked as sent in Buy-out, its one home). The ERP push is a later step:
 * its button is off and says why in plain sight.
 */
export default function HandoverPanel({ projectId, revisionId, revLabel, hasBudget, buyoutOn = false, initialBuyout }: {
  projectId: string; revisionId: string | null; revLabel: string | null; hasBudget: boolean;
  /** The project has a Buy-out tab: its awarded packages are listed. */
  buyoutOn?: boolean;
  /** Lets a server render (and its test) show the loaded package list. The page never passes it. */
  initialBuyout?: BuyoutData;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card title="Budget" info={PROJECT_TIPS.handover} padding={16}>
        <div data-guide="cp.handover" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: c.muted }}>{hasBudget && revLabel ? `Budget file for ${revLabel}.` : "There is no budget to hand over yet."}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {hasBudget ? (
              <Button variant="primary" href={`/api/contract-projects/${projectId}/handover${revisionId ? `?revision=${revisionId}` : ""}`} download data-guide="cp.handover.download" style={{ minHeight: 44 }}>
                Download Excel
              </Button>
            ) : (
              <Button variant="primary" disabled data-guide="cp.handover.download" style={{ minHeight: 44 }}>Download Excel</Button>
            )}
            <Button variant="secondary" disabled aria-describedby="cp-handover-send-why" data-guide="cp.handover.send" style={{ minHeight: 44 }}>Send to ePROMIS</Button>
          </div>
          <div id="cp-handover-send-why" data-guide="cp.handover.send_why" style={{ fontSize: 12.5, color: c.hint }}>Sending from here is not available yet. Download the Excel file for now.</div>
        </div>
      </Card>
      {buyoutOn && (
        <Card title="Packages" info={BUYOUT_TIPS.erpPackages} padding={16}>
          <HandoverPackages projectId={projectId} initial={initialBuyout} />
        </Card>
      )}
    </div>
  );
}
