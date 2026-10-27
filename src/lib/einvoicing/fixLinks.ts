import type { ReadinessIssue } from "./rules";

// Where a person goes to fix one item of the readiness list. One function, so the panel and its test agree.
//
//   seller.*   -> Settings > Company > Entities (the seller unit is an entity)
//   buyer.*    -> the account of the invoice
//   lines.*    -> the line's own row in the panel (an in-page anchor)
//   invoice.*  -> the invoice's Details (supply date, reason) or its Lines tab

export type FixTarget = { href: string; label: string } | null;

export const SELLER_FIX_HREF = "/settings/company?tab=entities";

export function lineAnchor(lineKey: string): string {
  return `einv-line-${lineKey}`;
}

export function fixTarget(issue: ReadinessIssue, ctx: { basePath: string; accountHref: string | null }): FixTarget {
  switch (issue.area) {
    case "seller":
      return { href: SELLER_FIX_HREF, label: "Open company settings" };
    case "buyer":
      return ctx.accountHref ? { href: ctx.accountHref, label: "Open the account" } : null;
    case "lines":
      return issue.line ? { href: `#${lineAnchor(issue.line)}`, label: "Go to line" } : { href: `${ctx.basePath}?tab=lines`, label: "Open lines" };
    case "invoice": {
      if (issue.field === "invoice.currency") return { href: "/settings/company?tab=tax", label: "Open currency settings" };
      if (issue.field === "invoice.lines" || issue.field === "invoice.total") return { href: `${ctx.basePath}?tab=lines`, label: "Open lines" };
      if (issue.field === "invoice.supply_date" || issue.field === "invoice.credit_reason") return { href: `${ctx.basePath}?tab=overview`, label: "Edit details" };
      // issued_at is stamped when the invoice is sent; original_invoice_id is set by "Create credit note".
      return null;
    }
  }
}
