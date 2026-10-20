import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { isSchemaPending } from "@/lib/marketing/pending";
import { errorResponse, isUuid, pendingResponse, signalsAccess } from "@/lib/signals/access";
import { loadAccountSignals } from "@/lib/signals/queries";
import { recomputeTenant } from "@/lib/signals/recompute";

// GET   /api/signals/intent/[accountId] -> the account's score with its working, timeline and sparkline.
// PATCH /api/signals/intent/[accountId] { action: "not_in_market" | "clear" } -> the team's own feedback:
//        an account marked not in market is held at Quiet for 30 days, and the mark is in the change history.
//
// The account id comes from the URL, so it is proven to belong to the caller's tenant before anything
// else is read or written (.eq("id", x).eq("tenant_id", tenantId)).

export async function GET(_req: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const ctx = await signalsAccess("view");
    const { accountId } = await params;
    if (!isUuid(accountId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data = await loadAccountSignals(ctx, accountId);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const ctx = await signalsAccess("edit");
    const { accountId } = await params;
    const body = await req.json().catch(() => null);
    const action = body?.action;
    if (!isUuid(accountId) || (action !== "not_in_market" && action !== "clear")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { data: acct } = await ctx.admin.from("accounts").select("id, name").eq("id", accountId).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!acct) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const markedAt = action === "not_in_market" ? new Date().toISOString() : null;
    const { data: existing, error: readErr } = await ctx.admin.from("account_intent").select("account_id")
      .eq("tenant_id", ctx.tenantId).eq("account_id", accountId).maybeSingle();
    if (readErr) return isSchemaPending(readErr) ? pendingResponse() : errorResponse(readErr);
    if (existing) {
      const { error } = await ctx.admin.from("account_intent").update({ marked_not_in_market_at: markedAt })
        .eq("tenant_id", ctx.tenantId).eq("account_id", accountId);
      if (error) return errorResponse(error);
    } else if (markedAt) {
      const { error } = await ctx.admin.from("account_intent").insert({ tenant_id: ctx.tenantId, account_id: accountId, marked_not_in_market_at: markedAt });
      if (error) return errorResponse(error);
    }
    await recomputeTenant(ctx.admin, ctx.tenantId, { source: "manual", only: [accountId], deadline: Date.now() + 40_000 });
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "account_intent", objectId: accountId, objectLabel: (acct as { name: string }).name,
      action: "update", actorId: ctx.userId, actorEmail: ctx.email,
      changes: [{ field: "Not in market", from: action === "not_in_market" ? "no" : "yes", to: action === "not_in_market" ? "yes" : "no" }],
    });
    return NextResponse.json({ ok: true, data: await loadAccountSignals(ctx, accountId) });
  } catch (e) {
    return errorResponse(e);
  }
}
