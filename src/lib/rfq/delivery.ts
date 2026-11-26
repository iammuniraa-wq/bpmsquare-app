// What each RFQ supplier row honestly is: sent, not sent, or answered (and how). PURE.
//
// A supplier status of "replied" says nothing about whether a request was ever sent: a reply entered by hand on a supplier with no email
// reads the same as an answer through the link. The RFQ summary used to count that supplier as sent. This file keeps the two apart.

import { hasValidEmail } from "./reach";
import type { RfqReplySource, RfqSupplierStatus } from "./types";

export type DeliveryTone = "purple" | "amber" | "blue" | "green" | "red";
export type DeliveryKey = "no_contact" | "no_email" | "not_sent" | "sent" | "opened" | "expired" | "by_link" | "by_email" | "by_sheet" | "by_hand" | "declined" | "removed";
export type SupplierDelivery = { key: DeliveryKey; label: string; tone: DeliveryTone };

export type DeliveryFacts = {
  status: RfqSupplierStatus;
  sent_at: string | null;
  reply_source: RfqReplySource | null;
  email_to: string | null;
  supplier_email?: string | null;
  supplier_phone?: string | null;
};

const L = (key: DeliveryKey, label: string, tone: DeliveryTone): SupplierDelivery => ({ key, label, tone });

export function supplierDelivery(f: DeliveryFacts): SupplierDelivery {
  if (f.status === "cancelled") return L("removed", "Removed", "red");
  if (f.status === "declined") {
    return f.reply_source === "link" || f.reply_source === "email" ? L("declined", "Declined", "red") : L("declined", "Declined, entered by hand", "red");
  }
  if (f.status === "replied") {
    switch (f.reply_source) {
      case "link": return L("by_link", "Replied by link", "green");
      case "email": return L("by_email", "Replied by email", "green");
      case "upload": return L("by_sheet", "Reply sheet uploaded", "green");
      default: return L("by_hand", "Reply entered by hand", "green");
    }
  }
  if (f.status === "sent") return L("sent", "Sent", "blue");
  if (f.status === "viewed") return L("opened", "Opened", "blue");
  if (f.status === "expired") return L("expired", "Expired", "amber");
  const email = hasValidEmail(f.email_to) || hasValidEmail(f.supplier_email);
  const phone = !!(f.supplier_phone ?? "").trim();
  if (!email && !phone) return L("no_contact", "Not sent: no contact on file", "amber");
  if (!email) return L("no_email", "Not sent: no email on file", "amber");
  return L("not_sent", "Not sent", "purple");
}

const ANSWERED: readonly RfqSupplierStatus[] = ["replied", "declined"];

export type DeliveryCounts = { invited: number; sent: number; notSent: number; noContact: number; byHand: number };

/** A supplier counts as sent when a request went out, or when it answered through the link or by email (which needs the request). */
export function deliveryCounts(list: readonly DeliveryFacts[]): DeliveryCounts {
  const live = list.filter((s) => s.status !== "cancelled");
  let sent = 0, notSent = 0, noContact = 0, byHand = 0;
  for (const s of live) {
    const answeredByRequest = ANSWERED.includes(s.status) && (s.reply_source === "link" || s.reply_source === "email");
    if (s.sent_at || answeredByRequest || s.status === "sent" || s.status === "viewed" || s.status === "expired") { sent++; continue; }
    notSent++;
    if (ANSWERED.includes(s.status)) byHand++;
    else if (supplierDelivery(s).key === "no_contact") noContact++;
  }
  return { invited: live.length, sent, notSent, noContact, byHand };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line under "Suppliers invited": says "all sent" only when every invited supplier was sent a request. */
export function deliverySummary(c: DeliveryCounts): string {
  if (c.invited === 0) return "add suppliers to start";
  if (c.notSent === 0) return "all sent";
  const parts = [`${c.sent} sent`];
  const unsent = c.notSent - c.byHand;
  if (unsent > 0) parts.push(c.noContact > 0 ? `${unsent} not sent (${c.noContact} with no contact)` : `${unsent} not sent`);
  if (c.byHand > 0) parts.push(`${plural(c.byHand, "reply", "replies")} entered by hand`);
  return parts.join(", ");
}

/** The sentence the New RFQ dialog shows before sending, naming who has no email or phone; null when everyone can be reached. */
export function noContactNotice(chosen: readonly { name: string; email: string | null; phone: string | null }[]): string | null {
  const bad = chosen.filter((s) => !hasValidEmail(s.email) && !(s.phone ?? "").trim());
  if (bad.length === 0) return null;
  const names = bad.map((b) => b.name || "A supplier").join(", ");
  const one = bad.length === 1;
  return `${bad.length} of ${chosen.length} ${chosen.length === 1 ? "supplier" : "suppliers"} ${one ? "has" : "have"} no email or phone (${names}): ${one ? "it" : "they"} will not receive it. Add a contact, or enter ${one ? "its" : "their"} reply by hand.`;
}
