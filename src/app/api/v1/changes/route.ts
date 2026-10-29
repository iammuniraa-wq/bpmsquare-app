import { resolveApiAuth, ERR_401_TENANT, ERR_403_SCOPE, jsonOk, jsonError, optionsResponse } from "../_auth";
import { applyChangeTypeFilter, canReadChangeType, CHANGE_EVENT_COLUMNS, changeTypeFilter, scopeForChangeType, shapeChangeEvent, type ChangeLogEventRow } from "@/lib/api/changeFeedScope";
import { createAdminSupabase } from "@/lib/supabase-server";

// GET /api/v1/changes?since=<cursor>&object_type=quotes&limit=100
//
// A tenant-scoped change feed (CDC) over change_log -- every create/update/
// delete, in order, cursor-paginated. Connected systems poll `since=<cursor>`
// to pull only what changed, instead of re-listing whole objects. This is the
// "sync engine" primitive OData/SOAP don't offer natively; it's also the basis
// the webhook dispatcher will replay from.
//
// The cursor is a keyset over (created_at, id), so no change is skipped or
// repeated across page boundaries even under same-timestamp writes.

const MAX_LIMIT = 500;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+([+-]\d{2}:?\d{2}|Z)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(created_at: string, id: string): string {
  return Buffer.from(`${created_at}|${id}`, "utf8").toString("base64url");
}
function decodeCursor(c: string): { ts: string; id: string } | null {
  try {
    const [ts, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
    if (ts && id && ISO.test(ts) && UUID.test(id)) return { ts, id };
  } catch { /* fall through */ }
  return null;
}

export async function GET(req: Request) {
  const auth = await resolveApiAuth(req);
  if (!auth || !auth.scopes.read) return ERR_401_TENANT();
  const tenantId = auth.tenantId;

  const { searchParams } = new URL(req.url);
  const objectType = searchParams.get("object_type");
  // The feed obeys the key's object scope like every list endpoint (audit 2026-10-21, M1).
  if (objectType && !canReadChangeType(auth.scopes, objectType)) return ERR_403_SCOPE(scopeForChangeType(objectType) ?? "*", false);
  const typeFilter = changeTypeFilter(auth.scopes);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10) || 100));

  const sinceRaw = searchParams.get("since");
  let cursor: { ts: string; id: string } | null = null;
  if (sinceRaw) {
    cursor = decodeCursor(sinceRaw);
    if (!cursor) return jsonError(422, "Invalid cursor", { message: "`since` must be a cursor returned by a previous /changes response." });
  }

  let q = createAdminSupabase()
    .from("change_log")
    .select(CHANGE_EVENT_COLUMNS)
    .eq("tenant_id", tenantId)                       // tenant isolation
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  q = applyChangeTypeFilter(q, typeFilter);
  if (objectType) q = q.eq("object_type", objectType);
  // Keyset: rows strictly after the cursor's (created_at, id).
  if (cursor) q = q.or(`created_at.gt.${cursor.ts},and(created_at.eq.${cursor.ts},id.gt.${cursor.id})`);

  const { data, error } = await q;
  if (error) return jsonError(500, "Could not read changes", { message: error.message });

  const rows = (data ?? []) as unknown as ChangeLogEventRow[];
  const last = rows[rows.length - 1];
  const nextCursor = last ? encodeCursor(last.created_at, last.id) : (sinceRaw ?? null);
  const hasMore = rows.length === limit;

  return jsonOk({
    data: rows.map(shapeChangeEvent),
    meta: { count: rows.length, has_more: hasMore, object_type: objectType ?? null },
    cursor: nextCursor,
    _links: {
      self: "/api/v1/changes",
      next: nextCursor ? `/api/v1/changes?since=${nextCursor}${objectType ? `&object_type=${objectType}` : ""}&limit=${limit}` : null,
    },
  });
}

export function OPTIONS() {
  return optionsResponse();
}
