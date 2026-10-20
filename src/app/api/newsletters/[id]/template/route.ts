import { NextResponse, type NextRequest } from "next/server";
import { CATEGORIES, type NewsletterCategory } from "@/lib/newsletter/types";
import { errorResponse, newsletterAccess, ownedBundle, pendingResponse, saveNewsletter } from "@/lib/newsletter/server";

// POST /api/newsletters/[id]/template { name?, category? }
// "Save as template": copies the design (blocks and every language's words, with their
// review state) into a template row. The newsletter itself is left as it is.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await newsletterAccess("create");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; category?: unknown };
    const src = await ownedBundle(ctx, id);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : `${src.newsletter.name} (template)`;
    const category = (CATEGORIES as readonly string[]).includes(String(body.category)) ? (body.category as NewsletterCategory) : src.newsletter.category;
    const saved = await saveNewsletter(ctx, null, {
      name, category, topic: src.newsletter.topic, is_template: true,
      blocks: src.newsletter.blocks, languages: src.languages,
      built_in_origin: src.newsletter.built_in_origin,
    });
    if ("missing" in saved) return pendingResponse();
    return NextResponse.json({ id: saved.id, ref: saved.ref }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
