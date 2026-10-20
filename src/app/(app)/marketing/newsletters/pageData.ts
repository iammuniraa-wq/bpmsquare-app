import "server-only";
import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { topicsOf } from "@/lib/marketing/config";
import { aiConfigured } from "@/lib/newsletter/aiServer";
import { FONT_PAIRINGS } from "@/lib/newsletter/types";
import { isMissingRelation, newsletterAccess, type NewsletterCtx } from "@/lib/newsletter/server";
import type { StudioProps } from "./NewsletterStudio";

/**
 * The start of every Newsletter Studio page: the workcenter and both feature flags
 * (Marketing and the platform-admin Newsletter Studio flag), then the tenant context.
 * A workspace without the studio gets "not found", exactly like a route that does not exist.
 */
export async function studioPage(): Promise<NewsletterCtx> {
  await requireWorkcenterView("marketing_newsletters");
  await requireFeature("marketing");
  await requireFeature("newsletter_studio");
  try {
    return await newsletterAccess("view");
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404 || status === 403) notFound();
    throw e;
  }
}

/** Everything the studio screen needs besides the newsletter itself. */
export async function studioProps(ctx: NewsletterCtx): Promise<Omit<StudioProps, "initial">> {
  const { data, error } = await ctx.supabase
    .from("newsletters").select("id, name, category")
    .eq("tenant_id", ctx.tenantId).eq("is_template", true).neq("status", "archived").order("updated_at", { ascending: false }).limit(60);
  const templates = error && isMissingRelation(error) ? [] : ((data ?? []) as { id: string; name: string; category: string }[]);
  return {
    topics: topicsOf(ctx.config).map((t) => ({ key: t.key, label: t.label })),
    templates,
    kit: {
      companyName: ctx.kit.companyName, primary: ctx.kit.primary, secondary: ctx.kit.secondary,
      fontLabel: `${FONT_PAIRINGS[ctx.kit.fontPairing]?.label ?? "Arial"} · Arabic: Tahoma, Segoe UI`,
      footerAddress: ctx.kit.footerAddress, hasLogo: !!ctx.kit.logoUrl,
    },
    canEdit: ctx.can.edit && ctx.can.create,
    isAdmin: ctx.role === "admin",
    aiReady: aiConfigured(),
    footerAddress: ctx.kit.footerAddress,
  };
}
