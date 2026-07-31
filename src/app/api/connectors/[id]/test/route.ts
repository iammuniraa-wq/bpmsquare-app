import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getDecryptedCredentials } from "@/lib/connectors/server";

/**
 * Sends a real test notification through the connector, not a canned
 * success response -- proves the stored credential actually works. Only
 * Slack exists today; a second connector adds its own case here rather than
 * this becoming a generic "POST the credential somewhere" helper, since
 * every provider's test call has a different shape.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const creds = await getDecryptedCredentials(supabase, tenantId, id);
  if (!creds) return NextResponse.json({ error: "Not connected" }, { status: 404 });

  if (id === "slack") {
    const res = await fetch(creds.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "✅ BPMSquare is connected to this Slack channel." }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json({ error: `Slack rejected the webhook (${res.status}): ${body || "no details"}` }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "This connector has no test action" }, { status: 400 });
}
