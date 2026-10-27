import "server-only";
import { emitQuoteAccepted, emitQuoteOutcomeChanged } from "./emitters";

// One place for "a Quotation's outcome moved", shared by the in-app PATCH and
// the v1 API PATCH so both channels fire the same events. Quotations carry the
// result in `outcome` (open / won / lost / dropped) next to a tenant-defined
// status; won is what a Standard Quote calls accepted.

type Row = Record<string, unknown>;

export async function emitQuotationOutcome(tenantId: string, before: Row, after: Row | null, actorId?: string | null): Promise<void> {
  if (!after) return;
  const from = typeof before.outcome === "string" ? before.outcome : null;
  const to = typeof after.outcome === "string" ? after.outcome : null;
  if (!to || to === from) return;
  const quoteId = String(after.id ?? before.id ?? "");
  if (!quoteId) return;
  const ref = typeof after.ref === "string" ? after.ref : typeof before.ref === "string" ? before.ref : null;
  const accountId = (after.account_id ?? before.account_id ?? null) as string | null;
  await emitQuoteOutcomeChanged(tenantId, { quoteId, ref, from, to, accountId, actorId });
  if (to === "won") {
    await emitQuoteAccepted(tenantId, {
      quoteId, objectType: "quote", ref, accountId, actorId,
      total: typeof after.total === "number" ? after.total : Number(after.total ?? 0) || null,
      contactId: (after.contact_id ?? before.contact_id ?? null) as string | null,
    });
  }
}
