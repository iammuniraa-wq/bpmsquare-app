import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail, needsUpdate } from "../_guard";
import { restartMessages } from "@/lib/middleware/restart";
import { MESSAGE_CHANNELS, MESSAGE_DIRECTIONS, type MessageFilters, type MonitorStatus } from "@/lib/middleware/types";

// POST { message_ids: string[] }  or  { filter: <the Monitor list's query>, limit?: number (at most 50) }
//   -> { results: [{ id, outcome: "done" | "failed" | "already_ok" | "not_restartable", message }] }
// Restart means the same for every row: an outbound document is sent again through the idempotent send (it never makes a
// twin), an inbound run row runs that entity again. Each id is loaded with this workspace; an id from another workspace is
// "not_restartable" and untouched. Safe to repeat. Serial, at most 50 per call.
export const maxDuration = 300;

const STATUSES = ["ok", "failed", "pending", "skipped", "redirected", "dry_run"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

function filterFrom(raw: unknown): MessageFilters {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const f: MessageFilters = {};
  if (typeof o.direction === "string" && (MESSAGE_DIRECTIONS as readonly string[]).includes(o.direction)) f.direction = o.direction as MessageFilters["direction"];
  if (typeof o.channel === "string" && (MESSAGE_CHANNELS as readonly string[]).includes(o.channel)) f.channel = o.channel as MessageFilters["channel"];
  if (typeof o.status === "string" && STATUSES.includes(o.status)) f.status = o.status as MonitorStatus;
  f.from = ISO(o.from);
  f.to = ISO(o.to);
  if (typeof o.object_id === "string" && UUID.test(o.object_id)) f.object_id = o.object_id;
  if (typeof o.q === "string" && o.q) f.q = o.q.slice(0, 100);
  return f;
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ message_ids?: unknown; filter?: unknown; limit?: unknown }>(req);
  if (!Array.isArray(body.message_ids) && (body.filter === undefined || body.filter === null)) return fail(422, "Choose the messages to restart.");
  const r = await restartMessages(g.ctx.admin, g.ctx.tenantId, g.ctx.userId, Array.isArray(body.message_ids) ? { ids: body.message_ids } : { filter: filterFrom(body.filter), limit: body.limit });
  if ("needsDatabaseUpdate" in r) return needsUpdate();
  return NextResponse.json(r);
}
