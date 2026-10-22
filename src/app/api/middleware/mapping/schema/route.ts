import { NextResponse } from "next/server";
import { guard, jsonBody } from "../../_guard";
import { fetchSchema } from "@/lib/middleware/mapping/engineOps";

export const maxDuration = 60;

// POST { connection, document, source: "adapter"|"openapi"|"odata"|"sample"|"manual", url?, sample?, fields?, linesPath?,
//        sendWebhookHeaders?, operation?: { method, path } }
//   -> { target, targetFields: { header, lines }, counts: { total, new, missing }, operations?, notes }
// The address must be https and public (assertSafeHttpsUrl), is fetched through fetchPublic with a size and time cap, may not
// carry a key in its query string, and is stored without credentials. For OData the entity set is chosen with
// operation: { method: "POST", path: "/<EntitySet>" }. When nothing matched, the answer is 200 { needsOperation: true, message,
// operations } and the person picks one. The fetched list is kept as a draft until the mapping is saved.
export async function POST(req: Request) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await fetchSchema(g.ctx, await jsonBody(req));
  return NextResponse.json(o.body, { status: o.status });
}
