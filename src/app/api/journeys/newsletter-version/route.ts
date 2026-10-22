import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, journeyAccess } from "@/lib/marketing/journeys/access";
import { resolveNewsletterForStep } from "@/lib/marketing/journeys/newsletterPick";
import { newsletterAccess } from "@/lib/newsletter/server";

// POST /api/journeys/newsletter-version { newsletter_id } -> { version_id, topic, languages }
// Picking a newsletter in a send step keeps a version of it (a new one only if it changed). Needs edit rights on
// Journeys and on Newsletters, the same two a person needed when this was two screens.
export async function POST(req: NextRequest) {
  try {
    const jctx = await journeyAccess("edit");
    const nctx = await newsletterAccess("edit");
    const body = (await req.json().catch(() => null)) as { newsletter_id?: unknown } | null;
    const r = await resolveNewsletterForStep(jctx, nctx, body?.newsletter_id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ version_id: r.version_id, topic: r.topic, languages: r.languages });
  } catch (e) {
    return errorResponse(e);
  }
}
