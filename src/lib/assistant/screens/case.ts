import type { ScreenOverlay } from "./types";

// Service case detail. The buttons under the stage change with the case's stage; ids stay the same.
export const CASE_DETAIL: ScreenOverlay = {
  id: "case.detail",
  tabs: [
    { id: "overview", label: "Overview", what: "The stage buttons, notes and the case's details." },
    { id: "inspection", label: "Inspection", what: "Findings, recommendations and the estimated cost." },
    { id: "photos", label: "Photos", what: "Intake and inspection photos." },
    { id: "related", label: "Related", what: "Sub-cases linked to this one." },
    { id: "activity", label: "Activity", what: "Who changed what, and when." },
  ],
  controls: [
    { id: "case.next_stage", label: "Next stage button", does: "Moves the case to its next stage (Start Inspection, Start Repair, Ready, Close, ...).", needs: "edit" },
    { id: "case.send_report", label: "Send report", does: "Marks the inspection report as sent to the customer.", needs: "edit" },
    { id: "case.create_quote", label: "Create Quotation", does: "Opens a new quotation for this case's customer.", featureKey: "quotations", workcenter: "quotations", needs: "create" },
    { id: "record.primary", label: "View quotation", does: "Opens the quotation raised for this case, when there is one." },
    { id: "tab:inspection", label: "Inspection tab", does: "Shows and edits the inspection report." },
    { id: "tab:photos", label: "Photos tab", does: "Shows the case's photos." },
  ],
  tasks: [
    {
      id: "advance", label: "Move the case to its next stage",
      steps: [{ control: "case.next_stage", text: "Press the main button under the stage; its label names the next stage." }],
    },
    {
      id: "inspect", label: "Write and send the inspection report",
      steps: [
        { control: "tab:inspection", text: "Open the Inspection tab and write the findings, recommendations and cost." },
        { control: "case.send_report", text: "Press the send button to mark the report as sent." },
      ],
    },
    {
      id: "quote_repair", label: "Quote the repair",
      steps: [{ control: "case.create_quote", text: "Press Create Quotation; the customer is filled in from the case." }],
    },
    {
      id: "photos", label: "Look at or add photos",
      steps: [{ control: "tab:photos", text: "Open the Photos tab; add photos at intake or inspection." }],
    },
  ],
};
