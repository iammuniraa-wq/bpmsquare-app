import { NextResponse, type NextRequest } from "next/server";
import { guard } from "../_guard";
import { listMessages } from "@/lib/middleware/monitor";
import { MESSAGE_CHANNELS, MESSAGE_DIRECTIONS, type MessageFilters, type MonitorStatus } from "@/lib/middleware/types";

// GET /api/middleware/messages?direction=in|out&channel=email|whatsapp|webhook|connector|api
//     &status=ok|failed|pending|skipped|redirected|dry_run&from=ISO&to=ISO&object_id=<uuid>&q=text
//     &cursor=<opaque>&limit=1..100
// -> { items: MonitorMessage[], nextCursor, needsDatabaseUpdate, bundle, missingSources, failedSources }
// Newest first, keyset-paged. Lists never carry a message body or a phone number.
const STATUSES = ["ok", "failed", "pending", "skipped", "redirected", "dry_run"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const sp = req.nextUrl.searchParams;
  const f: MessageFilters = {};
  const dir = sp.get("direction");
  if (dir && (MESSAGE_DIRECTIONS as readonly string[]).includes(dir)) f.direction = dir as MessageFilters["direction"];
  const ch = sp.get("channel");
  if (ch && (MESSAGE_CHANNELS as readonly string[]).includes(ch)) f.channel = ch as MessageFilters["channel"];
  const st = sp.get("status");
  if (st && STATUSES.includes(st)) f.status = st as MonitorStatus;
  f.from = ISO(sp.get("from"));
  f.to = ISO(sp.get("to"));
  const oid = sp.get("object_id");
  if (oid && UUID.test(oid)) f.object_id = oid;
  const q = sp.get("q");
  if (q) f.q = q.slice(0, 100);
  const page = await listMessages(g.ctx.admin, g.ctx.tenantId, f, sp.get("cursor"), Number(sp.get("limit") ?? 50));
  return NextResponse.json(page);
}
