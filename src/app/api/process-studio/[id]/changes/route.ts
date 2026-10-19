import { NextResponse, type NextRequest } from "next/server";
import { parseChangeCreate } from "@/lib/studio/requests";
import { effortBand } from "@/lib/studio/effort";
import { studioAccess, errorResponse, ownedStudy, insertRows } from "@/lib/studio/server";
import { runChanges } from "@/lib/studio/run";
import facts from "@/lib/capability/facts.generated.json";
import { CONNECTOR_CATALOG } from "@/lib/connectors/registry";

export const maxDuration = 120;

// Step 4.
//
// POST {}                          -> propose the changes from the Partly / Not covered / unresolved rows
// POST { add: true, kind, title, plain? } -> a change in the client's own words (kept, client_added)
//
// The effort band is set here by rule from the kind, never by the model or the client.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const study = await ownedStudy(ctx, (await params).id);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    if (body?.add === true) {
      const parsed = parseChangeCreate(body);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
      const known = {
        hooks: new Set((facts.extensionHooks as { name: string }[]).map((h) => h.name)),
        connectors: new Set(CONNECTOR_CATALOG.map((c) => c.id)),
      };
      const { data: last } = await ctx.supabase.from("process_study_changes").select("sort_order")
        .eq("tenant_id", ctx.tenantId).eq("study_id", study.id).order("sort_order", { ascending: false }).limit(1);
      const next = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? -10) + 10;
      const [change] = await insertRows(ctx, "process_study_changes", study.id, [{
        ...parsed.value, effort_band: effortBand(parsed.value.kind, { extensionHook: null, connector: null }, known),
        step_ids: [], kept: true, client_added: true, sort_order: next,
      }]);
      return NextResponse.json({ change }, { status: 201 });
    }

    return NextResponse.json(await runChanges(ctx, study));
  } catch (e) {
    return errorResponse(e);
  }
}
