import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextSeqFromRefs, firstFreeRef } from "@/lib/refSeq";

// Employees were built before lib/masterRef.ts and never joined that family,
// so their business id (employee_code) stayed hand-typed while accounts,
// contacts, assets, suppliers and inventory all generate theirs. That is an
// oversight rather than a decision -- it produced real duplicates in the wild
// ("EMP-10" alongside "emp-10", which the case-sensitive unique index treats
// as different people).
//
// Not folded into masterRef.ts because employees differ in two ways that
// matter: the id lives in `employee_code`, not `ref`, and it stays USER
// EDITABLE. Plenty of tenants already have a payroll or biometric numbering
// scheme of their own, and forcing EMP-0001 on them would be worse than the
// problem. Generation is therefore the default, not the rule.

const PREFIX = "EMP";
const SEQ_DIGITS = 4; // matches ACC-0001 / CON-0001 across the rest of the product

export function formatEmployeeCode(seq: number): string {
  return `${PREFIX}-${String(seq).padStart(SEQ_DIGITS, "0")}`;
}

/**
 * The next free EMP-#### for this tenant. Same two-stage approach as
 * generateNextMasterRef: derive from the highest existing sequence (never a
 * row count -- that reissues a deleted record's number forever), then probe
 * forward for the first genuinely free one. The unique index stays the final
 * arbiter of a race; see the retry in POST /api/wfm/employees.
 *
 * Codes that don't match the generated shape -- a tenant's own "BPM-001", or
 * "TEST-WFM-01" -- simply don't participate: they can't collide with an
 * EMP-#### and they don't move the sequence.
 */
export async function generateEmployeeCode(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const PAGE = 1000;
  const codes: (string | null)[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("employees")
      .select("employee_code")
      .eq("tenant_id", tenantId)
      .like("employee_code", `${PREFIX}-%`)
      .range(from, from + PAGE - 1);
    const batch = (data ?? []) as { employee_code: string | null }[];
    codes.push(...batch.map((r) => r.employee_code));
    if (batch.length < PAGE) break;
  }

  const start = nextSeqFromRefs(codes, new RegExp(`^${PREFIX}-(\\d+)$`));
  return firstFreeRef(supabase, "employees", tenantId, formatEmployeeCode, start, 200, "employee_code");
}
