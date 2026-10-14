"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import { inp, lbl, btnPrimary, fmtDateTime } from "@/components/rfq/rfqUi";

type Cfg = { mail_mode: "platform" | "mailbox"; mailbox_connector: "gmail" | "mail_server"; default_response_days: number; max_reminders: number; link_grace_days: number; terms: string };
type Ready = {
  reply_link: boolean; platform_send: boolean; platform_receive: boolean; inbound_domain: string | null;
  mailboxes_connected: string[]; mailbox_last_polled_at: string | null; mailbox_last_error: string | null;
};

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, color: c.ink, alignItems: "flex-start" }}>
      <span aria-hidden style={{ color: ok ? "var(--greenink)" : "var(--amberink)", fontWeight: 700 }}>{ok ? "✓" : "!"}</span>
      <span>{children}</span>
    </div>
  );
}

export default function RfqSettingsClient() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/rfq").then((r) => r.json()).then((j) => { setCfg(j.config); setReady(j.readiness); }).catch(() => setMsg({ ok: false, text: "Couldn't load the settings." }));
  }, []);

  if (!cfg || !ready) return <div style={{ ...cardStyle, color: c.hint }}>Loading…</div>;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/settings/rfq", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Couldn't save." }); return; }
    setCfg(j.config);
    setReady(j.readiness);
    setMsg({ ok: true, text: "Saved." });
  };

  const radio = (value: Cfg["mail_mode"], title: string, body: string) => (
    <label style={{ ...cardStyle, cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start", borderColor: cfg.mail_mode === value ? c.accent : undefined }}>
      <input type="radio" name="mode" checked={cfg.mail_mode === value} onChange={() => setCfg({ ...cfg, mail_mode: value })} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontWeight: 700, color: c.ink, fontSize: 14 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12.5, color: c.muted, marginTop: 4, lineHeight: 1.5 }}>{body}</span>
      </span>
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>Mail channel</div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {radio("mailbox", "Your own mailbox", "RFQs go out from your company address (Gmail, or any mail server). Supplier replies arrive in that inbox as usual AND are filed on the right RFQ in BPMSquare every few minutes.")}
          {radio("platform", "BPMSquare sends and receives", "RFQs go out from BPMSquare's sender. Each supplier gets a personal reply-to address, so their reply lands straight on the RFQ — nothing to set up in your own mailbox.")}
        </div>
        {cfg.mail_mode === "mailbox" && (
          <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={lbl} htmlFor="conn">Mailbox</label>
              <select id="conn" style={{ ...inp, maxWidth: 320 }} value={cfg.mailbox_connector} onChange={(e) => setCfg({ ...cfg, mailbox_connector: e.target.value as Cfg["mailbox_connector"] })}>
                <option value="gmail">Gmail (App Password)</option>
                <option value="mail_server">Mail server (SMTP / IMAP)</option>
              </select>
            </div>
            <Check ok={ready.mailboxes_connected.includes(cfg.mailbox_connector)}>
              {ready.mailboxes_connected.includes(cfg.mailbox_connector)
                ? "Connected."
                : <>Not connected yet — connect it under <Link href={ROUTES.settingsConnectors} style={{ color: c.accent }}>Settings → Connectors</Link>, then save here.</>}
            </Check>
            {ready.mailbox_last_polled_at && <Check ok={!ready.mailbox_last_error}>Inbox last checked {fmtDateTime(ready.mailbox_last_polled_at)}{ready.mailbox_last_error ? ` — error: ${ready.mailbox_last_error}` : ""}</Check>}
          </div>
        )}
        {cfg.mail_mode === "platform" && (
          <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 8 }}>
            <Check ok={ready.platform_send}>{ready.platform_send ? "Sending is set up." : "Sending isn't configured on this platform yet (RESEND_API_KEY)."}</Check>
            <Check ok={ready.platform_receive}>{ready.platform_receive ? `Replies come back through ${ready.inbound_domain}.` : "Receiving isn't configured on this platform yet — suppliers can still answer on the reply link, or you can enter their reply. (Platform setup: INBOUND_EMAIL_DOMAIN + RESEND_INBOUND_WEBHOOK_SECRET.)"}</Check>
          </div>
        )}
        <Check ok={ready.reply_link}>{ready.reply_link ? "Every RFQ carries a no-login reply link for each supplier." : "Reply links are off on this platform (RFQ_LINK_SECRET is not set) — suppliers reply by email only."}</Check>
      </section>

      <section style={{ ...cardStyle, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div>
          <label style={lbl} htmlFor="days">Days to reply</label>
          <input id="days" type="number" min={1} max={90} style={inp} value={cfg.default_response_days} onChange={(e) => setCfg({ ...cfg, default_response_days: Number(e.target.value) })} />
        </div>
        <div>
          <label style={lbl} htmlFor="rem">Reminders per supplier</label>
          <input id="rem" type="number" min={0} max={5} style={inp} value={cfg.max_reminders} onChange={(e) => setCfg({ ...cfg, max_reminders: Number(e.target.value) })} />
        </div>
        <div>
          <label style={lbl} htmlFor="grace">Link works for (days after deadline)</label>
          <input id="grace" type="number" min={0} max={90} style={inp} value={cfg.link_grace_days} onChange={(e) => setCfg({ ...cfg, link_grace_days: Number(e.target.value) })} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl} htmlFor="terms">Terms printed on every RFQ</label>
          <textarea id="terms" rows={4} style={{ ...inp, resize: "vertical" }} value={cfg.terms} onChange={(e) => setCfg({ ...cfg, terms: e.target.value })} placeholder="e.g. Prices to include packing. Quote valid for at least 30 days. We are not bound to accept the lowest offer." />
        </div>
      </section>

      {msg && <div role={msg.ok ? "status" : "alert"} style={{ fontSize: 13, color: msg.ok ? "var(--greenink)" : "var(--redink)" }}>{msg.text}</div>}
      <div><button type="button" style={btnPrimary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
    </div>
  );
}
