import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/pagedRead";
import { loadItems, loadMembers } from "@/lib/tender/wbs/read";
import { isMissingSchema, loadLines } from "./server";
import { mapTenderWbs, wbsCopyText } from "./fromTender";

// The project takes over the tender's WBS as its own copy (docs/design/wbs.md section 2.5): items first, parents before children, then the whole
// lines, then the shares of split lines, each with `source_wbs_item_id` pointing back at the tender item. It runs once, at creation, and the
// tender's WBS is never read again by the project. While migration 0243 is pending the project is made WITHOUT a WBS and says so; a copy that
// fails halfway is taken back out, so a project never carries half a tree.

export type WbsCopyResult = { pending: boolean; failed: boolean; items: number; lines: number; split: number; unassigned: number; text: string | null };
const none = (over: Partial<WbsCopyResult> = {}): WbsCopyResult => ({ pending: false, failed: false, items: 0, lines: 0, split: 0, unassigned: 0, text: null, ...over });

export async function copyTenderWbs(admin: SupabaseClient, tenantId: string, projectId: string, userId: string, opportunityId: string, revisionId: string): Promise<WbsCopyResult> {
  const tender = await loadItems(admin, tenantId, opportunityId);
  if (tender.pending) return none({ pending: true });
  if (tender.items.length === 0) return none();

  // The project's tables must carry the tree (0243) before anything is copied.
  const probes = await Promise.all([
    admin.from("project_work_packages").select("parent_id, source_wbs_item_id, code_is_manual").eq("tenant_id", tenantId).limit(1),
    admin.from("project_work_package_line_parts").select("id").eq("tenant_id", tenantId).limit(1),
  ]);
  if (probes.some((p) => isMissingSchema(p.error))) return none({ pending: true });

  const members = await loadMembers(admin, tenantId, opportunityId);
  if (members.pending) return none({ pending: true });
  const rows = await readAllPages((lo, hi) => admin.from("tender_boq_lines").select("id, line_id").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("id", { ascending: true }).range(lo, hi));
  if (rows.error) return none({ failed: true });
  const boq = ((rows.data ?? []) as { id: string; line_id: string | null }[]).map((r) => ({ line_id: r.line_id, wbs_item_id: members.members.item.get(r.id) ?? null, parts: members.members.parts.get(r.id) ?? [] }));
  const budgetLines = await loadLines(admin, tenantId, revisionId);

  const plan = mapTenderWbs({ items: tender.items, boq, budgetLines, newId: () => randomUUID() });
  const made: string[] = [];
  const undo = async () => {
    if (made.length === 0) return;
    // The foreign keys cascade these; naming them keeps the take-back whole wherever the keys are not enforced.
    await admin.from("project_work_package_line_parts").delete().eq("tenant_id", tenantId).eq("project_id", projectId).in("package_id", made);
    await admin.from("project_work_package_lines").delete().eq("tenant_id", tenantId).eq("project_id", projectId).in("package_id", made);
    await admin.from("project_work_packages").delete().eq("tenant_id", tenantId).eq("project_id", projectId).in("id", made);
  };

  // Level by level, so a child never points at a parent that is not there yet.
  const level = new Map<string, number>();
  for (const it of plan.items) level.set(it.new_id, it.parent ? (level.get(it.parent) ?? 0) + 1 : 1);
  for (let depth = 1; depth <= 3; depth++) {
    const batch = plan.items.filter((it) => level.get(it.new_id) === depth);
    if (batch.length === 0) continue;
    const { error } = await admin.from("project_work_packages").insert(batch.map((it) => ({
      id: it.new_id, tenant_id: tenantId, project_id: projectId, parent_id: it.parent, source_wbs_item_id: it.source_id, code: it.code, name: it.name,
      owner_employee_id: it.owner_employee_id, code_is_manual: it.code_is_manual, sort_order: it.sort_order, created_by: userId,
    })));
    if (error) { await undo(); return none({ failed: true, pending: isMissingSchema(error) }); }
    made.push(...batch.map((it) => it.new_id));
  }
  if (plan.whole.length > 0) {
    const { error } = await admin.from("project_work_package_lines").insert(plan.whole.map((w) => ({ tenant_id: tenantId, project_id: projectId, package_id: w.package, line_key: w.line_key, sort_order: w.sort_order })));
    if (error) { await undo(); return none({ failed: true }); }
  }
  if (plan.parts.length > 0) {
    const { error } = await admin.from("project_work_package_line_parts").insert(plan.parts.map((p) => ({ tenant_id: tenantId, project_id: projectId, package_id: p.package, line_key: p.line_key, share_pct: p.share_pct, sort_order: p.sort_order })));
    if (error) { await undo(); return none({ failed: true }); }
  }
  return none({ ...plan.summary, text: wbsCopyText(plan.summary) });
}
