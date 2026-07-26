import { NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/marketingUnsubscribe";
import { setAccountMarketingOptOut } from "@/lib/data";

// The actual state change -- deliberately a POST triggered by a button click
// on the unsubscribe page, not the page's own GET load, since some mail
// clients/security scanners prefetch links inside emails and would otherwise
// unsubscribe someone who never clicked anything.
export async function POST(_request: Request, { params }: { params: Promise<{ accountId: string; token: string }> }) {
  const { accountId, token } = await params;
  if (!verifyUnsubscribeToken(accountId, token)) {
    return NextResponse.json({ error: "This link is invalid." }, { status: 404 });
  }
  const ok = await setAccountMarketingOptOut(accountId);
  if (!ok) return NextResponse.json({ error: "Failed to unsubscribe" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
