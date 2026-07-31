import { NextResponse, type NextRequest } from "next/server";
import nodemailer from "nodemailer";
import { requireTenantUser } from "@/lib/supabase-server";
import { getDecryptedCredentials } from "@/lib/connectors/server";
import { parseIcsEvents } from "@/lib/connectors/ics";

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

  if (id === "google_calendar") {
    const res = await fetch(creds.ical_url);
    if (!res.ok) return NextResponse.json({ error: `Could not fetch that calendar feed (${res.status}) — double check the secret URL` }, { status: 400 });
    const text = await res.text();
    const now = Date.now();
    const upcoming = parseIcsEvents(text)
      .filter((e) => e.start && e.start.getTime() >= now)
      .sort((a, b) => a.start!.getTime() - b.start!.getTime())
      .slice(0, 5);
    if (upcoming.length === 0) return NextResponse.json({ ok: true, message: "Connected — no upcoming events found on this calendar." });
    return NextResponse.json({ ok: true, message: `Connected — ${upcoming.length} upcoming event${upcoming.length === 1 ? "" : "s"}, next: "${upcoming[0].summary}"` });
  }

  if (id === "gmail") {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: creds.email, pass: creds.app_password },
    });
    try {
      await transporter.sendMail({
        from: creds.email,
        to: creds.email,
        subject: "BPMSquare test email",
        text: "This is a test email sent from BPMSquare's Gmail connector. If you're reading this, it works.",
      });
    } catch (e: unknown) {
      const err = e as { message?: string };
      return NextResponse.json({ error: `Gmail rejected the send: ${err.message ?? "unknown error"} — double check the address and app password` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: `Sent a test email to ${creds.email}` });
  }

  return NextResponse.json({ error: "This connector has no test action" }, { status: 400 });
}
