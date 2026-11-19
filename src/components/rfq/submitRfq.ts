// The one place the RFQ forms talk to POST /api/rfqs.

import type { SentRow } from "@/lib/rfq/sendOutcome";

export type RfqSubmitResult = {
  id: string;
  ref: string;
  line_ids: string[];
  sent?: SentRow[];
};

/** What a form hands back once the RFQ exists. `sendRequested` + `sent` let the caller tell "saved and sent" from "saved, but the send failed". */
export type RfqCreated = RfqSubmitResult & { line_keys: (string | null)[]; sendRequested?: boolean };

export async function submitRfq(body: Record<string, unknown>): Promise<RfqSubmitResult> {
  const res = await fetch("/api/rfqs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "Could not create the RFQ.");
  return j as RfqSubmitResult;
}
