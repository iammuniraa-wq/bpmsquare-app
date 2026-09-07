// AI-drafted intake (docs/fence-configurator-architecture.md §14b): paste
// a client's email, get a starting configuration. Gated on the
// fence_projects feature itself -- NOT next_experience -- since this is
// part of a real, sold module already live for this tenant, not
// experimental Nova UI (bpmsquarecore §10 rule 1 is about protecting
// existing clients from unfinished Nova surfaces; a tenant that already
// has fence_projects on has already opted into this object).

import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { getFenceSecurityProfiles } from "@/lib/fence/data";
import { draftFenceProject } from "@/lib/fence/draft";
import { ExtractionError } from "@/lib/import/extract";

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const hasFeature = await tenantHasFeature(supabase, tenantId, "fence_projects");
  if (!hasFeature) return NextResponse.json({ error: "Fence Projects isn't enabled for this tenant" }, { status: 404 });

  const body = await request.json();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Paste the client's message first" }, { status: 400 });

  const profiles = await getFenceSecurityProfiles(tenantId);

  try {
    const draft = await draftFenceProject(text, profiles);
    return NextResponse.json(draft);
  } catch (e) {
    if (e instanceof ExtractionError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
