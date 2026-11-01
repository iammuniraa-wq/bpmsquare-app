import { BOQ_LIMITS } from "@/lib/tender/boq/parse";
import { TENDER_BOQ_LINES_SPEC } from "@/lib/import/tenderBoqLinesSchema";
import { TENDER_BOQ_LIST_TARGET, TENDER_BOQ_OPEN_PREFIX, type NavTarget } from "./navTargets";

// What the assistant says when asked to upload a BOQ, for the BOQ Excel format, for bulk import or export of BOQ lines, or whether the
// BOQ can be pulled through the API or MCP. Kept beside the nav targets so the answer and the button agree: the tender's Bill of
// quantities tab, never Estimates (an estimate template is a different thing). The limits come from the parser's own constants and the
// Data Workbench object name from its own spec, so the answer cannot drift from what the product enforces.

/** The Data Workbench screen in the NAVIGATION list: present only when the workspace has it switched on and the caller may open it. */
export const DATA_WORKBENCH_TARGET = "nav:/data-workbench";

/** The v1 endpoints and MCP tools that carry a tender's BOQ. Pinned by boqHelp.test.ts against the manifest and the API index. */
export const TENDER_API_PATHS = ["/api/v1/tenders", "/api/v1/tenders/{id}", "/api/v1/tenders/{id}/boq"] as const;
export const TENDER_MCP_TOOLS = ["list_tenders", "get_tender", "get_tender_boq"] as const;

/** The rule appended to the assistant prompt; empty when the caller cannot reach tenders at all. */
export function boqUploadRule(targets: readonly NavTarget[]): string {
  const open = targets.find((t) => t.id.startsWith(TENDER_BOQ_OPEN_PREFIX));
  const list = targets.find((t) => t.id === TENDER_BOQ_LIST_TARGET);
  if (!open && !list) return "";
  const lines = BOQ_LIMITS.maxLines.toLocaleString("en-US");
  const mb = Math.round(BOQ_LIMITS.maxFileBytes / (1024 * 1024));
  const hasWorkbench = targets.some((t) => t.id === DATA_WORKBENCH_TARGET);
  const object = TENDER_BOQ_LINES_SPEC.label;

  const upload =
    "\n\nBOQ UPLOAD: when someone asks to upload a BOQ, for the BOQ Excel template or the BOQ format, the answer is the TENDER's Bill of quantities, never Estimates or New Estimate (an estimate template is a different thing). " +
    "Answer in four short lines: (1) open the tender in Pipeline, Tenders, then its Bill of quantities tab and press Upload BOQ; (2) Download BOQ template on that toolbar gives a ready file, and the client's own Excel works as it is; " +
    "(3) the columns read are Item no., Description, Unit, Quantity and an optional Cost code, found from the header row; a Narration column is also read (it becomes the line name and the Description is kept as details), and the client's other columns such as Sr #, Bill #, Section, Page # and Revision # are kept as client data, as is a Project Code and Project Name block above the table; " +
    `(4) up to ${lines} lines and ${mb} MB per file, so a larger BOQ is split by package and the parts uploaded one after the other. ` +
    `Then call navigate with ${open ? `${open.id} (the tender that is open now)` : list!.id}.`;

  const bulk = hasWorkbench
    ? `Bulk import and export: Data Workbench has the object "${object}". Import adds new lines and updates the ones it matches by item number, and never removes a line. Export writes every line with its Record ID. Update changes quantity, description, details and cost code by Record ID.`
    : "Bulk import and export of BOQ lines: Data Workbench is not switched on for this person. Say so in one sentence, name Upload BOQ on the tender's Bill of quantities tab as the way to load or revise a BOQ, and never describe Data Workbench steps or offer to open it.";

  const machine =
    `API and MCP: the BOQ can be pulled with GET ${TENDER_API_PATHS.join(", GET ")}, using an API key that names the tenders scope (an administrator mints it in Settings, API keys and developer), and through the MCP tools ${TENDER_MCP_TOOLS.join(", ")}. ` +
    "A row carries item no., cost code, description, details, client columns, unit, quantity, our unit rate and amount, the rate source and date, and the status. Cost, markup and supplier names are never exposed on any of these.";

  return (
    upload +
    "\n\nBOQ FORMAT AND CONNECTIONS: for questions about which columns, what format, using the client's own Excel, the limits, bulk import or export of BOQ lines, or reading the BOQ through the API or MCP, answer in at most four short lines from the facts here and nothing else; never invent a column, a path or a tool. " +
    bulk + " " + machine
  );
}
