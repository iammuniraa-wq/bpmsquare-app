// The review table after an email is read: one row per template input, with what was read,
// how sure it is (Found, Likely, Missing) and the email's own words. Pure, no I/O.
// Missing rows show the form's default only as a placeholder and say so: nothing is guessed.

import type { IntakeProposal, IntakeStatus } from "@/lib/estimator/ai";
import type { TemplateInput } from "@/lib/estimator/types";
import type { PillarKey } from "@/lib/theme";

export type ReviewRow = {
  key: string;
  label: string;
  status: IntakeStatus;
  statusLabel: string;
  tone: PillarKey;
  /** What was read, in the input's words ("2.4 m", "High security 25x25"), or "" when missing. */
  value: string;
  /** The default the form is showing for a missing input. */
  placeholder: string;
  source: string | null;
};

const STATUS: Record<IntakeStatus, { label: string; tone: PillarKey }> = {
  found: { label: "Found", tone: "green" },
  likely: { label: "Likely", tone: "blue" },
  missing: { label: "Missing", tone: "amber" },
};

const num = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 3 });

export function describeValue(i: TemplateInput, v: number | string | boolean | undefined): string {
  if (v === undefined) return "";
  if (i.type === "boolean") return v === true ? "Yes" : "No";
  if (i.type === "select") return i.options?.find((o) => o.key === v)?.label ?? String(v);
  return `${typeof v === "number" ? num(v) : String(v)}${i.unit ? ` ${i.unit}` : ""}`;
}

const ORDER: Record<IntakeStatus, number> = { missing: 0, likely: 1, found: 2 };

/** Rows for the table: what needs the person first (Missing, then Likely), then what the email stated. */
export function reviewRows(inputs: readonly TemplateInput[], proposal: Pick<IntakeProposal, "values" | "fields">): ReviewRow[] {
  const rows = inputs.map((i, idx) => {
    const f = proposal.fields?.[i.key];
    const status: IntakeStatus = proposal.values[i.key] === undefined ? "missing" : (f?.status === "found" || f?.status === "likely" ? f.status : "likely");
    return {
      idx,
      row: {
        key: i.key, label: i.label, status, statusLabel: STATUS[status].label, tone: STATUS[status].tone,
        value: status === "missing" ? "" : describeValue(i, proposal.values[i.key]),
        placeholder: describeValue(i, i.default),
        source: status === "missing" ? null : (f?.source ?? null),
      } satisfies ReviewRow,
    };
  });
  return rows.sort((a, b) => ORDER[a.row.status] - ORDER[b.row.status] || a.idx - b.idx).map((r) => r.row);
}

export function reviewCounts(rows: readonly ReviewRow[]): Record<IntakeStatus, number> {
  return rows.reduce((acc, r) => { acc[r.status]++; return acc; }, { found: 0, likely: 0, missing: 0 } as Record<IntakeStatus, number>);
}

/** A short note per input the form should mark: Missing ("the email did not say") and Likely (the words it was read from). */
export function fieldNotes(inputs: readonly TemplateInput[], proposal: Pick<IntakeProposal, "values" | "fields">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of reviewRows(inputs, proposal)) {
    if (r.status === "missing") out[r.key] = `The email did not say. ${r.placeholder} is only a placeholder: check it.`;
    else if (r.status === "likely") out[r.key] = r.source ? `Read as likely from: "${r.source}". Check it.` : "Read as likely from the email. Check it.";
  }
  return out;
}
