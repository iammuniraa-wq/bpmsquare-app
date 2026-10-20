import { NextResponse, type NextRequest } from "next/server";
import { formatMoney, resolveCurrency } from "@/lib/currency";
import { topicsOf } from "@/lib/marketing/config";
import { aiDraft } from "@/lib/newsletter/aiServer";
import type { CatalogueItem } from "@/lib/newsletter/ai";
import { parseDraft } from "@/lib/newsletter/requests";
import { errorResponse, newsletterAccess } from "@/lib/newsletter/server";

// POST /api/newsletters/ai/draft { brief, use_products?, use_campaigns?, topic? }
//   -> { subject, preheader, blocks, texts, understood, assumed, warnings }
// Drafts in English. The result lands in the studio UNSAVED, with blue "understood" and
// amber "assumed" chips; a person reviews every block. The model only ever sees a product's
// name, short description and LIST price: cost is never selected, so it cannot be sent.
// A product card's id comes from this tenant's own catalogue by number, never from the model.

export async function POST(req: NextRequest) {
  try {
    const ctx = await newsletterAccess("create");
    const parsed = parseDraft(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

    let catalogue: CatalogueItem[] = [];
    if (parsed.useProducts) {
      const cur = resolveCurrency(ctx.config);
      const { data } = await ctx.supabase
        .from("products").select("id, name, description, list_price, status")
        .eq("tenant_id", ctx.tenantId).order("updated_at", { ascending: false }).limit(10);
      catalogue = ((data ?? []) as { id: string; name: string; description: string | null; list_price: number | null; status?: string }[])
        .filter((p) => p.status !== "inactive" && p.status !== "archived")
        .map((p) => ({ id: p.id, name: p.name, description: p.description ?? "", price: p.list_price != null ? formatMoney(Number(p.list_price), cur, { maximumFractionDigits: 2 }) : "" }));
    }

    let recentSubjects: string[] = [];
    if (parsed.useCampaigns) {
      const { data } = await ctx.supabase
        .from("marketing_campaigns").select("subject").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(5);
      recentSubjects = ((data ?? []) as { subject: string }[]).map((r) => r.subject).filter(Boolean);
    }

    const topicLabel = parsed.topic ? topicsOf(ctx.config).find((t) => t.key === parsed.topic)?.label ?? null : null;
    const draft = await aiDraft(
      { tenantId: ctx.tenantId, userId: ctx.userId, config: ctx.config },
      { brief: parsed.brief, companyName: ctx.tenantName, tone: ctx.kit.tone, footerAddress: ctx.kit.footerAddress, catalogue, recentSubjects, topicLabel },
    );
    return NextResponse.json(draft);
  } catch (e) {
    return errorResponse(e);
  }
}
