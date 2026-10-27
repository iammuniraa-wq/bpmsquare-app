// Who an RFQ can actually be e-mailed to. PURE. Sending to a supplier with no e-mail used to fail inside the send loop and came back as a bare
// "Request failed (502)"; the routes now sort the recipients first and say, by name, who cannot be reached and what to do.

export type Recipient = { id: string; name: string; email: string | null; phone: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const hasValidEmail = (email: string | null | undefined): boolean => EMAIL.test((email ?? "").trim());

export function splitReachable<T extends Recipient>(list: readonly T[]): { reachable: T[]; unreachable: T[] } {
  const reachable: T[] = [];
  const unreachable: T[] = [];
  for (const r of list) (hasValidEmail(r.email) ? reachable : unreachable).push(r);
  return { reachable, unreachable };
}

const names = (list: readonly string[]): string => (list.length <= 1 ? list[0] ?? "" : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);

/** The sentence for suppliers that cannot be e-mailed: who, whether they have a phone for WhatsApp, and what to do. */
export function unreachableMessage(unreachable: readonly Recipient[], nothingSent: boolean): string {
  const label = unreachable.map((r) => (r.phone && r.phone.trim() ? r.name || "A supplier" : `${r.name || "A supplier"} (no phone either)`));
  const who = names(label);
  const verb = unreachable.length === 1 ? "has" : "have";
  return `${nothingSent ? "Nothing was sent. " : ""}${who} ${verb} no email address. Add one on the supplier, or copy the reply link and share it on WhatsApp.`;
}
