import { quantityConfirmCopy, type QuantityView } from "@/lib/tender/estimates/rules";

// The confirmation a person gives before a rate build-up is priced from an estimate that is not known to be made for the line's quantity
// (GCC tender deals, slice 3c-1). The screen asks first when it already knows; the server enforces the same rule with a 409, so a call
// that skips the screen meets it too, and a screen that did not know is asked by the answer and tries once more with the confirmation.

type Confirm = (o: { title: string; body?: string; confirmLabel?: string }) => Promise<boolean>;
export type RepriceAnswer = { ok: boolean; status: number; json: Record<string, unknown> & { error?: string; repriced?: unknown[]; failed?: { item: string; reason: string }[] } };

/** The lines of this list that need a person's word before they are priced. */
export const unconfirmed = (views: readonly (QuantityView | null | undefined)[]): QuantityView[] => views.filter((v): v is QuantityView => !!v?.needs_confirm);

/** POSTs a re-price. Resolves null when the person declined the confirmation. */
export async function postReprice(url: string, body: Record<string, unknown>, known: readonly QuantityView[], confirm: Confirm): Promise<RepriceAnswer | null> {
  const send = async (extra: Record<string, unknown>): Promise<RepriceAnswer> => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...extra }) });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  };
  if (known.length > 0) {
    if (!(await confirm(quantityConfirmCopy(known)))) return null;
    return send({ confirm_quantity: true });
  }
  const first = await send({});
  const lines = (first.json as { lines?: QuantityView[] }).lines;
  if (first.status === 409 && (first.json as { code?: string }).code === "quantity_unconfirmed" && Array.isArray(lines) && lines.length > 0) {
    if (!(await confirm(quantityConfirmCopy(lines)))) return null;
    return send({ confirm_quantity: true });
  }
  return first;
}
