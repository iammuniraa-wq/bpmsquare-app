import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { draftStandardQuoteIntro, StandardQuoteAIError } from "@/lib/standardQuoteAI";

type LineInput = { description?: unknown; qty?: unknown; rate?: unknown };

// Suggestion-only -- never writes anything, works the same whether the quote
// is still a draft in the create form or already saved (the client sends its
// current account/line state either way, so there's no need for a
// quote-id-scoped variant of this route).
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const accountId = typeof body.account_id === "string" ? body.account_id : "";
  if (!accountId) return NextResponse.json({ error: "account_id is required" }, { status: 400 });

  const { data: account } = await supabase.from("accounts").select("name").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const rawLines = Array.isArray(body.lines) ? (body.lines as LineInput[]).slice(0, 200) : [];
  const lineDescriptions = rawLines
    .map((l) => (typeof l.description === "string" ? l.description.trim().slice(0, 300) : ""))
    .filter(Boolean);
  if (lineDescriptions.length === 0) return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });

  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : null;

  try {
    const introText = await draftStandardQuoteIntro({ accountName: account.name, lineDescriptions, notes });
    return NextResponse.json({ intro_text: introText });
  } catch (e) {
    if (e instanceof StandardQuoteAIError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error("[standard-quotes/ai-intro] unexpected error", e);
    return NextResponse.json({ error: "AI drafting failed" }, { status: 500 });
  }
}
