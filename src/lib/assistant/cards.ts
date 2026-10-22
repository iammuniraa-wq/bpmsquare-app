// The confirm card: the one shape every create (and later update) the assistant proposes is drawn in. Client-safe
// and data only, so the dock renders a card for an object it has never heard of without a new branch.
// docs/design/assistant-smarter.md section 8, contracts.

export type CardWidget = "text" | "textarea" | "enum" | "ref" | "date" | "number" | "checkbox";

export type CardField = {
  key: string;
  label: string;
  value: string;
  required: boolean;
  widget: CardWidget;
  /** enum, select and ref fields: what the person can pick. A ref's value is the record id. */
  options?: { value: string; label: string }[];
  /**
   * "web": the value was proposed from a web lookup the person agreed to, not typed by them. The card says so in words;
   * the addresses it came from are never part of a card (they live only in the audit row).
   */
  origin?: "web";
  /** Only on a web lookup: how sure the lookup was, or that it found nothing for this field. */
  confidence?: "found" | "likely" | "not_found";
};

export type CardDuplicate = { id: string; label: string; href: string };

export type NextStep = {
  id: string;
  label: string;
  kind: "navigate" | "ask";
  target?: string;
  question?: string;
};

export type ConfirmCard = {
  /** Also the idempotency key: one execution per card id. */
  id: string;
  /** Signed proof the server issued this card to this person; sent back unchanged with the press. */
  token: string;
  action: "create" | "update";
  object: string;
  noun: string;
  title: string;
  /** The assistant's own restatement of what it is about to do, shown above the fields. */
  summary: string;
  fields: CardField[];
  /** Similar records that already exist, checked before the card is shown. */
  duplicates: CardDuplicate[];
  /** Blockers worth reading before pressing (an account that was not found, for one). */
  notices: string[];
  primaryLabel: string;
  risk: "write";
};

export type ActResult = {
  ok: true;
  record: { id: string; href: string; label: string };
  next: NextStep[];
};

/** Required fields that are still empty, by key. */
export function missingRequired(fields: Pick<CardField, "key" | "required" | "value">[], values: Record<string, string>): string[] {
  return fields.filter((f) => f.required && !(values[f.key] ?? "").trim()).map((f) => f.key);
}
