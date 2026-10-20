import { NextResponse, type NextRequest } from "next/server";
import { handleClick } from "@/lib/newsletter/clickHandler";

// The signed, no-login newsletter click link: /marketing/c/<campaign>/<recipient>/<index>/<token>.
// Everything that matters is in handleClick(): the token is verified before the database is
// touched, and the only place this ever redirects is the address stored at that index of the
// newsletter version the campaign points at -- never anything taken from the request.
// Unsubscribe and interest links are not wrapped in this; they keep working with tracking off.

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ campaignId: string; recipientId: string; index: string; token: string }> }) {
  const p = await params;
  const out = await handleClick({ ...p, userAgent: req.headers.get("user-agent") });
  if (!out.ok) return new NextResponse("This link is invalid.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return NextResponse.redirect(out.url, 302);
}
