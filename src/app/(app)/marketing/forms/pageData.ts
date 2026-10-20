import "server-only";
import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { formsAccess, type FormsCtx } from "@/lib/marketing/forms/server";

/**
 * The start of every Forms page: the workcenter and both feature flags (Marketing and the
 * platform-admin Forms flag), then the tenant context. A workspace without Forms gets "not
 * found", exactly like a route that does not exist.
 */
export async function formsPage(): Promise<FormsCtx> {
  await requireWorkcenterView("marketing_forms");
  await requireFeature("marketing");
  await requireFeature("marketing_forms");
  try {
    return await formsAccess("view");
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404 || status === 403) notFound();
    throw e;
  }
}
