import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, pendingResponse, signalsAccess } from "@/lib/signals/access";
import { listTopics } from "@/lib/signals/queries";
import { createTopic, parseTopic, type TopicInput } from "@/lib/signals/topics";

// GET  /api/signal-topics -> { topics }   (anyone who can see Buying signals)
// POST /api/signal-topics { name, keywords?, enabled? } -> 201 { topic }   (admin)

export async function GET() {
  try {
    const ctx = await signalsAccess("view");
    const r = await listTopics(ctx);
    return NextResponse.json({ topics: r.topics, ...(r.pending ? { pending_migration: true } : {}) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await signalsAccess("admin");
    const parsed = parseTopic(await req.json().catch(() => null), false);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const r = await createTopic(ctx, parsed.value as TopicInput);
    if (!r.ok) return r.pending ? pendingResponse() : NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ topic: r.value }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
