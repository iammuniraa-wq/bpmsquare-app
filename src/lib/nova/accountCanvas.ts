import type { Contact, Quote } from "@/lib/types";
import { ROUTES } from "@/lib/constants";

/**
 * Nodes for Nova's Canvas (Constellation) graph -- the account's real
 * contacts and real open quotes, not the design prototype's mock "Dana
 * Reyes / Enterprise Rollout — €240K" relationship. No fabricated
 * "Champion" designation either: a contact's role is shown exactly as
 * recorded (contacts.role), nothing invented on top of it.
 */

export type CanvasNode = {
  id: string;
  label: string;
  meta: string;
  href: string;
  accent: "orange" | "pink" | "purple" | "teal";
};

export type QuoteCanvasNode = CanvasNode & {
  ref: string;
  status: string;
  total: number;
};

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const CONTACT_ACCENTS: CanvasNode["accent"][] = ["teal", "purple", "pink", "orange"];

export function buildAccountCanvas(input: {
  contacts: Pick<Contact, "id" | "name" | "role">[];
  quotes: Pick<Quote, "id" | "ref" | "status" | "total" | "outcome">[];
}): { contactNodes: CanvasNode[]; dealNodes: QuoteCanvasNode[] } {
  const contactNodes: CanvasNode[] = input.contacts.slice(0, 4).map((ct, i) => ({
    id: `contact:${ct.id}`,
    label: ct.name,
    meta: ct.role || "Contact",
    href: ROUTES.contact(ct.id),
    accent: CONTACT_ACCENTS[i % CONTACT_ACCENTS.length],
  }));

  const dealNodes: QuoteCanvasNode[] = input.quotes
    .filter((q) => q.outcome === "open")
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
    .slice(0, 3)
    .map((q) => ({
      id: `quote:${q.id}`,
      label: q.ref,
      meta: `${q.status} · ${money(q.total ?? 0)}`,
      href: ROUTES.quotation(q.id),
      accent: "orange" as const,
      ref: q.ref,
      status: q.status,
      total: q.total ?? 0,
    }));

  return { contactNodes, dealNodes };
}
