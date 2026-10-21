import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canViewWorkcenter } from "@/lib/permissions";
import { parsePageContext, type AssistantObjectType } from "./objects";
import { loadRecord, loadRelated, canUseObject, type AssistantCtx, type LoadedRecord } from "./sources";
import { filterByAccess, ownWorkSuggestions, suggestionsFor, type Suggestion } from "./suggestions";
import { loadOwnWork } from "./ownWork";
import { objectDef } from "./objects";

// What the dock shows for the screen the person is on: the one-line context fact and the suggestions strip. The
// route is the only thing the client sends; the server parses it again, loads the record through the caller's own
// permissions and the workspace's own rows, and returns labels and rule output, never record data.

export type PageInfo = {
  context: { label: string; objectType: AssistantObjectType; recordId: string } | null;
  suggestions: Suggestion[];
};

export type ResolvedPage = { record: LoadedRecord; objectType: AssistantObjectType; recordId: string };

/** The record behind a route, or null: not a record page, module off, no view grant, or an id that is not this workspace's. */
export async function resolvePageRecord(ctx: AssistantCtx, route: unknown): Promise<ResolvedPage | null> {
  const page = parsePageContext(typeof route === "string" ? route : null);
  if (!page || !page.recordId) return null;
  if (!canUseObject(ctx, objectDef(page.objectType))) return null;
  const record = await loadRecord(ctx, page.objectType, page.recordId);
  return record ? { record, objectType: page.objectType, recordId: page.recordId } : null;
}

export async function describePage(
  admin: SupabaseClient, ctx: AssistantCtx, userId: string, route: unknown, now: Date = new Date(),
): Promise<PageInfo> {
  const access = { features: ctx.features, canView: (wc: Parameters<typeof canViewWorkcenter>[1]) => canViewWorkcenter(ctx.perms, wc) };
  const page = await resolvePageRecord(ctx, route).catch(() => null);

  if (page) {
    const related = await loadRelated(ctx, page.objectType, page.record.row).catch(() => ({}));
    return {
      context: { label: page.record.title, objectType: page.objectType, recordId: page.recordId },
      suggestions: filterByAccess(suggestionsFor(page.objectType, page.record.row, related, now), access),
    };
  }

  const own = await loadOwnWork(admin, ctx, userId, now).catch(() => ({}));
  return { context: null, suggestions: filterByAccess(ownWorkSuggestions(own), access) };
}
