import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions } from "@/lib/permissions";
import { askAssistant, capabilityList, AssistantError } from "@/lib/ai/assistant";

// GET /api/ai/ask -- what the assistant can help with, for its empty state.
// Scoped to this caller's Business Roles, so it never advertises a lookup
// the person isn't allowed to run.
export async function GET() {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  return NextResponse.json({ capabilities: capabilityList(perms) });
}

// POST /api/ai/ask -- answer one read-only question about this tenant's data.
// The tenant is taken from the session (requireTenantUser), never from the
// request body, and the model can only pick from a fixed catalog of
// pre-approved read queries -- see src/lib/ai/assistant.ts for why that
// shape was chosen.
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Ask me something first." }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ error: "That question is too long." }, { status: 400 });

  const perms = await resolvePermissions(supabase, tenantId, userId, role);

  try {
    const reply = await askAssistant(question, { supabase, tenantId, perms });
    return NextResponse.json(reply);
  } catch (e) {
    if (e instanceof AssistantError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("Assistant failed:", e);
    return NextResponse.json({ error: "The assistant is unavailable right now." }, { status: 500 });
  }
}
