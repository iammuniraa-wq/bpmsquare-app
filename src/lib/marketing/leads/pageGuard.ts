import "server-only";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { getTenant } from "@/lib/tenant";
import type { TenantConfig } from "@/lib/constants";
import { marketingScoringOn } from "../config";
import { rubricFromConfig } from "./scorer";
import type { ScoringRubric } from "../scoring";

// The start of the scored-lead pages: someone who may see Leads, in a
// workspace that has the Leads module and the scoring program. A workspace
// without the program gets the same 404 as an address that never existed.

export type LeadPageContext = {
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  rubric: ScoringRubric;
  now: Date;
};

export async function leadPage(): Promise<LeadPageContext> {
  await requireWorkcenterView("leads");
  const tenant = await getTenant();
  if (!tenant?.features?.leads || !marketingScoringOn(tenant.features)) notFound();
  const { tenantId, userId, role } = await requireTenantUser();
  return {
    admin: createAdminSupabase(), tenantId, userId, role: role === "admin" ? "admin" : "member",
    rubric: rubricFromConfig(tenant.config as Partial<TenantConfig> | undefined), now: new Date(),
  };
}
