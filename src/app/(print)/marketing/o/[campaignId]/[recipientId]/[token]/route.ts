import { NextResponse, type NextRequest } from "next/server";
import { handleOpen } from "@/lib/newsletter/clickHandler";

// The open-tracking pixel, /marketing/o/<campaign>/<recipient>/<token>. Off by default: a
// newsletter only carries this image when the workspace turned opens on, and even then
// nothing is recorded unless that setting is still on when the image is fetched.

export const runtime = "nodejs";

// 1x1 transparent GIF.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(req: NextRequest, { params }: { params: Promise<{ campaignId: string; recipientId: string; token: string }> }) {
  const p = await params;
  await handleOpen({ ...p, userAgent: req.headers.get("user-agent") });
  return new NextResponse(GIF, { status: 200, headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0" } });
}
