import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { c } from "@/lib/theme";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

/** Hand the project over: the Excel file now; the ERP push is a later step and its button says so. */
export default function HandoverPanel({ projectId, revisionId, revLabel, hasBudget }: { projectId: string; revisionId: string | null; revLabel: string | null; hasBudget: boolean }) {
  return (
    <Card title="Hand over to the ERP" info={PROJECT_TIPS.handover} padding={16}>
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
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Button variant="secondary" disabled data-guide="cp.handover.send" style={{ minHeight: 44 }}>Send to ePROMIS</Button>
            <InfoTip label="Send to ePROMIS">{PROJECT_TIPS.sendToErp}</InfoTip>
          </span>
        </div>
      </div>
    </Card>
  );
}
