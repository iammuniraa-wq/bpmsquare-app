import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { controlPlanePublicKeys, verifySummaryRequest } from "@/lib/controlPlane/crypto";
import { buildSummary } from "@/lib/controlPlane/summary";

// GET /api/platform/summary -- the control plane's signed pull (docs/dedicated-instance.md 7.1). Public to the proxy (no session): the
// Ed25519 signature in x-cp-* is the credential and is verified BEFORE the database is touched. Dark by default: with
// CONTROL_PLANE_PUBLIC_KEYS unset the route answers 404, so a deployment that never opted in looks like it has no such route.
// The payload is platform-level (tenants of this database) and carries no key, no config and no person; see lib/controlPlane/summary.ts.

export const dynamic = "force-dynamic";

const NOT_FOUND = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(request: NextRequest) {
  const keys = controlPlanePublicKeys();
  if (keys.length === 0) return NOT_FOUND();
  const v = verifySummaryRequest(keys, {
    ts: request.headers.get("x-cp-ts"),
    nonce: request.headers.get("x-cp-nonce"),
    sig: request.headers.get("x-cp-sig"),
  });
  if (!v.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await buildSummary(createAdminSupabase());
  return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
}
