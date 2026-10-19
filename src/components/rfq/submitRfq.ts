// The one place the RFQ forms talk to POST /api/rfqs.

export type RfqSubmitResult = {
  id: string;
  ref: string;
  line_ids: string[];
  sent?: { supplier: string; ok: boolean; reason?: string }[];
};

export async function submitRfq(body: Record<string, unknown>): Promise<RfqSubmitResult> {
  const res = await fetch("/api/rfqs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "Could not create the RFQ.");
  return j as RfqSubmitResult;
}
