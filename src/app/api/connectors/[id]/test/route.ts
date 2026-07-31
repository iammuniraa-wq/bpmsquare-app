import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getDecryptedCredentials, getValidAccessToken } from "@/lib/connectors/server";

/**
 * Sends a real test notification through the connector, not a canned
 * success response -- proves the stored credential actually works. Each
 * connector adds its own case here rather than this becoming a generic
 * "POST the credential somewhere" helper, since every provider's test call
 * has a different shape.
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

  if (id === "slack") {
    const creds = await getDecryptedCredentials(supabase, tenantId, id);
    if (!creds) return NextResponse.json({ error: "Not connected" }, { status: 404 });
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

  if (id === "google_calendar") {
    const token = await getValidAccessToken(supabase, tenantId, id);
    if (!token) return NextResponse.json({ error: "Not connected, or the connection needs to be redone" }, { status: 404 });
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("maxResults", "5");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("timeMin", new Date().toISOString());
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json({ error: `Google rejected the request (${res.status}): ${body || "no details"}` }, { status: 400 });
    }
    const json = (await res.json()) as { items?: { summary?: string; start?: { dateTime?: string; date?: string } }[] };
    const items = json.items ?? [];
    if (items.length === 0) return NextResponse.json({ ok: true, message: "Connected — no upcoming events found on this calendar." });
    const first = items[0];
    return NextResponse.json({ ok: true, message: `Connected — ${items.length} upcoming event${items.length === 1 ? "" : "s"}, next: "${first.summary ?? "(no title)"}"` });
  }

  if (id === "gmail") {
    const token = await getValidAccessToken(supabase, tenantId, id);
    if (!token) return NextResponse.json({ error: "Not connected, or the connection needs to be redone" }, { status: 404 });

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${token}` } });
    if (!profileRes.ok) return NextResponse.json({ error: "Could not read the connected account's email address" }, { status: 400 });
    const profile = (await profileRes.json()) as { email?: string };
    const email = profile.email;
    if (!email) return NextResponse.json({ error: "Google did not return an email address for this account" }, { status: 400 });

    const raw = Buffer.from(
      `To: ${email}\r\nSubject: BPMSquare test email\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\nThis is a test email sent from BPMSquare's Gmail connector. If you're reading this, it works.`
    ).toString("base64url");
    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!sendRes.ok) {
      const body = await sendRes.text().catch(() => "");
      return NextResponse.json({ error: `Gmail rejected the send (${sendRes.status}): ${body || "no details"}` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: `Sent a test email to ${email}` });
  }

  return NextResponse.json({ error: "This connector has no test action" }, { status: 400 });
}
