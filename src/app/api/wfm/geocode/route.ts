import { NextResponse, type NextRequest } from "next/server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { forwardGeocode } from "@/lib/wfm/geocode";

// GET /api/wfm/geocode?address=... — text address -> {lat, lng}, for the
// site picker's "search an address" box. Server-side only: the Ola Maps key
// must never reach the client bundle (see lib/wfm/geocode.ts).
export async function GET(request: NextRequest) {
  try {
    await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const address = request.nextUrl.searchParams.get("address") ?? "";
  if (!address.trim()) return NextResponse.json({ error: "address is required" }, { status: 400 });

  const result = await forwardGeocode(address);
  if (result.status === "ok") {
    return NextResponse.json({ lat: result.lat, lng: result.lng, formatted_address: result.formatted_address });
  }
  if (result.status === "empty") {
    return NextResponse.json({ error: "No location found for that address" }, { status: 404 });
  }
  return NextResponse.json({ error: result.reason }, { status: 503 });
}
