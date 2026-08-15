import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextSeqFromRefs, firstFreeRef } from "./refSeq";

// Employee codes are SYSTEM-GENERATED (owner decision 2026-08-15): like every
// other business id in the product (ACC-/CON-/AST-/SUP-/INV-, quote refs),
// the user never types one -- the only influence is format/number-range
// configuration, which is a future Settings concern. This closes the class
// of defect KAN-13 exposed (user-typed EMP-10 vs emp-10): a code that is
// never typed can never collide, case-insensitively or otherwise.
//
// Mirrors masterRef.ts exactly, except employees keep their business id in
// `employee_code` rather than `ref`.

const PREFIX = "EMP";
const PATTERN = /^EMP-(\d+)$/;

export function formatEmployeeCode(seq: number): string {
  return `${PREFIX}-${String(seq).padStart(4, "0")}`;
}

/** Next unused sequence for this tenant -- paginated like nextMasterRefSeq
 * so a tenant past PostgREST's ~1000-row cap can't derive a colliding max. */
export async function nextEmployeeCodeSeq(supabase: SupabaseClient, tenantId: string): Promise<number> {
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
  return nextSeqFromRefs(codes, PATTERN);
}

export async function generateNextEmployeeCode(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const start = await nextEmployeeCodeSeq(supabase, tenantId);
  return firstFreeRef(supabase, "employees", tenantId, formatEmployeeCode, start, 200, "employee_code");
}

/** The CI unique index (0080) turns a probe/insert race into a clean 23505. */
export function isEmployeeCodeCollision(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "23505" && (error.message ?? "").includes("employees_tenant_code_ci_uniq");
}
