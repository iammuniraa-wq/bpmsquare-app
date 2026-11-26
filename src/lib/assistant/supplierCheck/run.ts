import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actionsEnabled } from "@/lib/actions/registry";
import { issueOnceConsent } from "@/lib/assistant/consentToken";
import { promptText } from "@/lib/assistant/promptSafe";
import { ROUTES, type TenantConfig } from "@/lib/constants";
import { createAdminSupabase } from "@/lib/supabase-server";
import { canEditWorkcenter, type PermissionSet } from "@/lib/permissions";
import { findSuppliers } from "@/lib/suppliers/check/load";
import { SUPPLIER_CHECK_SEARCHES } from "@/lib/suppliers/check/research";
import { buildCheck, checkGate, readChecks, type CheckDeps } from "@/lib/suppliers/check/service";
import { consentQueryFor, issueSaveToken } from "@/lib/suppliers/check/token";
import { supplierCheckDigest, type DockSupplierCheck, type SupplierCheckInput } from "./tool";

// One supplier-check step for the dock. Order of play: the person's right to see suppliers, the supplier resolved BY NAME OR REFERENCE
// inside this workspace (an ambiguous name is put back to the person, never guessed), the records-only check computed in code (no
// model, no web, no cost), then the offers on the card: web research behind a signed yes for exactly this supplier, and saving behind
// the assistant's actions and the person's own right to edit suppliers. Nothing is written here.

export type SupplierCheckStepCtx = {
  /** Test seam; the service-role client of this process otherwise. Every query on it is scoped by `tenantId`. */
  admin?: SupabaseClient;
  tenantId: string;
  userId: string;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  budget: number;
  /** The folded answer of the platform flag, the assistant and the workspace policy (assistant/webConsent.ts webAvailability). */
  webEnabled: boolean;
  /** The supplier the person has open, already verified against this workspace by the page service. */
  openSupplier: { id: string; name: string } | null;
  /** Test seam. */
  deps?: CheckDeps;
};

export type SupplierCheckOutcome =
  | { kind: "card"; check: DockSupplierCheck }
  | { kind: "ask"; message: string }
  | { kind: "error"; message: string };

export async function stepSupplierCheck(c: SupplierCheckStepCtx, input: SupplierCheckInput): Promise<SupplierCheckOutcome> {
  const admin = c.admin ?? createAdminSupabase();
  const access = { admin, tenantId: c.tenantId, userId: c.userId, perms: c.perms, features: c.features, config: {} as Partial<TenantConfig>, budget: c.budget };
  const gate = checkGate(access, "view");
  if (!gate.ok) return { kind: "error", message: gate.status === 404 ? "Suppliers are not part of this workspace." : gate.error };

  let target: { id: string; name: string } | null = null;
  if (input.supplier) {
    const hits = await findSuppliers(admin, c.tenantId, input.supplier);
    if (hits.length === 0) return { kind: "error", message: `I could not find a supplier called "${promptText(input.supplier, 80)}" in this workspace.` };
    if (hits.length > 1) {
      const list = hits.map((h) => `${promptText(h.name, 80)}${h.ref ? ` (${promptText(h.ref, 20)}${h.city ? `, ${promptText(h.city, 40)}` : ""})` : ""}`).join("; ");
      return { kind: "ask", message: `Several suppliers match: ${list}. Ask the person which one they mean, then call the tool again with that name or reference.` };
    }
    target = { id: hits[0].id, name: hits[0].name };
  } else if (c.openSupplier) target = c.openSupplier;
  if (!target) return { kind: "error", message: "Name the supplier to check, or open its page." };

  const built = await buildCheck(access, target.id, { web: null }, c.deps);
  if (!built.ok) return { kind: "error", message: built.error };

  const canRun = canEditWorkcenter(c.perms, "suppliers");
  const saved = await readChecks(access, target.id, target.name, 1);
  const check: DockSupplierCheck = {
    supplierId: target.id, name: target.name, result: built.result,
    web: canRun && c.webEnabled
      ? { searches: SUPPLIER_CHECK_SEARCHES, consent: (() => { const id = randomUUID(); return { id, token: issueOnceConsent({ tenantId: c.tenantId, userId: c.userId, query: consentQueryFor(target!.id), id }) }; })() }
      : null,
    saveToken: canRun && actionsEnabled(c.features) ? issueSaveToken({ tenantId: c.tenantId, userId: c.userId, result: built.result }) : null,
    lastSaved: saved.latest ? { checkedAt: saved.latest.checkedAt, verdict: saved.latest.verdict } : null,
    notice: built.notice, href: ROUTES.supplier(target.id), digest: supplierCheckDigest(built.result),
  };
  return { kind: "card", check };
}
