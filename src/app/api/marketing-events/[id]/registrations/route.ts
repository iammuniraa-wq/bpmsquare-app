import { NextResponse, type NextRequest } from "next/server";
import { moduleAccess, moduleErrorResponse } from "@/lib/marketing/moduleAccess";
import { EVENTS_SPEC, addRegistration } from "@/lib/marketing/events/server";

// POST /api/marketing-events/[id]/registrations { contact_id, check_in? } -- a person adds someone (a walk-in, a
// phone sign-up). The contact is loaded by id AND this workspace inside registerPerson(); adding someone who is
// already registered changes nothing. Nothing is sent to the person and no consent is recorded: that is the form's job.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await moduleAccess(EVENTS_SPEC, "edit");
    const { id } = await params;
    const b = (await req.json().catch(() => null)) as { contact_id?: unknown; check_in?: unknown } | null;
    const r = await addRegistration(ctx, id, b?.contact_id, b?.check_in === true);
    if (!("registrationId" in r)) {
      if (r.status === "no_contact") return NextResponse.json({ error: "Person not found." }, { status: 404 });
      if (r.status === "no_event") return NextResponse.json({ error: "Event not found." }, { status: 404 });
      return NextResponse.json({ error: "Could not register the person." }, { status: 503 });
    }
    return NextResponse.json({ status: r.status, id: r.registrationId }, { status: r.status === "already" ? 200 : 201 });
  } catch (e) {
    return moduleErrorResponse(EVENTS_SPEC, e);
  }
}
