// Editing an EXISTING fence_security_profiles row -- there's still no
// Settings screen to author a brand-new one (that's the fuller build
// this route deliberately doesn't attempt), but the configurator lets a
// rep tune a real profile's spacing/pipe/embedment live for an estimate,
// and until now that tuning had nowhere to persist -- switching away
// silently discarded it. This closes that gap without building the full
// Settings CRUD.

import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();

  const allowed = ["label", "blurb", "post_spacing_m", "embedment_m", "pipe_class"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];
  if (!("label" in patch) || typeof patch.label !== "string" || !patch.label.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { data: before } = await supabase.from("fence_security_profiles").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("fence_security_profiles")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  const changes = diffForLog("fence_security_profiles", (before as Record<string, unknown>) ?? {}, patch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "fence_security_profiles", objectId: id, objectLabel: (data as { label?: string }).label ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(data);
}
