import { BOQ_LIMITS } from "@/lib/tender/boq/parse";
import { TENDER_BOQ_LIST_TARGET, TENDER_BOQ_OPEN_PREFIX, type NavTarget } from "./navTargets";

// What the assistant says when asked to upload a BOQ or for the BOQ Excel format. Kept beside the nav targets so the answer
// and the button agree: the tender's Bill of quantities tab, never Estimates (an estimate template is a different thing).
// The limits come from the parser's own constants, so the answer cannot drift from what the upload enforces.

/** The rule appended to the assistant prompt; empty when the caller cannot reach tenders at all. */
export function boqUploadRule(targets: readonly NavTarget[]): string {
  const open = targets.find((t) => t.id.startsWith(TENDER_BOQ_OPEN_PREFIX));
  const list = targets.find((t) => t.id === TENDER_BOQ_LIST_TARGET);
  if (!open && !list) return "";
  const lines = BOQ_LIMITS.maxLines.toLocaleString("en-US");
  const mb = Math.round(BOQ_LIMITS.maxFileBytes / (1024 * 1024));
  return (
    "\n\nBOQ UPLOAD: when someone asks to upload a BOQ, for the BOQ Excel template or the BOQ format, the answer is the TENDER's Bill of quantities, never Estimates or New Estimate (an estimate template is a different thing). " +
    "Answer in four short lines: (1) open the tender in Pipeline, Tenders, then its Bill of quantities tab and press Upload BOQ; (2) Download BOQ template on that toolbar gives a ready file, and the client's own Excel works as it is; " +
    "(3) the columns read are Item no., Description, Unit, Quantity and an optional Cost code, found from the header row; " +
    `(4) up to ${lines} lines and ${mb} MB per file, so a larger BOQ is split by package and the parts uploaded one after the other. ` +
    `Then call navigate with ${open ? `${open.id} (the tender that is open now)` : list!.id}.`
  );
}
