"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatusPill from "@/components/ui/StatusPill";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import { c } from "@/lib/theme";
import type { ContactConsent } from "@/lib/marketing/contactConsent";

const CHANNELS: { id: string; label: string }[] = [
  { id: "email", label: "Email" }, { id: "whatsapp", label: "WhatsApp" }, { id: "sms", label: "SMS" }, { id: "phone", label: "Phone calls" },
];
const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((x) => [x.id, x.label]));
const BASIS_LABEL: Record<string, string> = {
  consent: "They agreed", existing_customer: "Existing customer", contract: "Needed for their contract", legitimate_interest: "Legitimate interest",
};
const BASIS_HINT: Record<string, string> = {
  consent: "They told you they are happy to hear from us. This is the safe choice everywhere.",
  existing_customer: "They already buy from us and may hear about similar products. Only offered where the law and your settings allow it.",
};
const SOURCE_LABEL: Record<string, string> = {
  rep: "Recorded by a person", form: "A form", preference_centre: "Their preferences page", unsubscribe_link: "An unsubscribe link",
  import: "A file import", api: "An integration", provider_webhook: "The email service",
};
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function ConsentCard({ contactId, consent: initial, canEdit }: { contactId: string; consent: ContactConsent; canEdit: boolean }) {
  const router = useRouter();
  const [consent, setConsent] = useState(initial);
  const [form, setForm] = useState<null | "granted" | "withdrawn">(null);
  const [channel, setChannel] = useState("email");
  const [topic, setTopic] = useState("");
  const [basis, setBasis] = useState("consent");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  if (!consent.available) {
    return (
      <Card title="Consent">
        <p className="bpm-t-help" style={{ margin: 0 }}>Waiting for a database update. This card will fill in once it has been applied.</p>
      </Card>
    );
  }

  const topicLabel = (key: string) => (key === "" ? "All topics" : consent.topics.find((t) => t.key === key)?.label ?? key);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/consent`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, topic: topic || null, status: form, basis: form === "granted" ? basis : null, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tone: "err", text: json.error ?? "That did not work. Try again." }); return; }
      setConsent(json.consent as ContactConsent);
      setMsg({ tone: "ok", text: form === "granted" ? "Recorded that they agreed." : "Recorded that they withdrew." });
      setForm(null); setNote("");
      router.refresh();
    } catch {
      setMsg({ tone: "err", text: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Consent">
      <p className="bpm-t-help" style={{ margin: "0 0 10px" }}>
        What this person has agreed to hear from us about{consent.jurisdictionLabel ? ` (rules for ${consent.jurisdictionLabel})` : ""}. Every answer is kept; a new answer never erases an old one.
      </p>

      {consent.rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13.5, color: c.ink }}>No answer recorded yet, so we do not email this person about marketing unless your workspace allows it for existing customers.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Channel", "About", "Answer", "Since", "Basis", "How we know"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px 6px 0", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: c.hint, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {consent.rows.map((r) => (
                <tr key={`${r.channel}:${r.topic}`} style={{ borderTop: `1px solid ${c.line}` }}>
                  <td style={{ padding: "8px 10px 8px 0" }}>{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                  <td style={{ padding: "8px 10px 8px 0" }}>{topicLabel(r.topic)}</td>
                  <td style={{ padding: "8px 10px 8px 0" }}><StatusPill label={r.status === "granted" ? "Agreed" : "Withdrawn"} tone={r.status === "granted" ? "green" : "red"} /></td>
                  <td style={{ padding: "8px 10px 8px 0", color: c.muted, whiteSpace: "nowrap" }}>{fmt(r.since)}</td>
                  <td style={{ padding: "8px 10px 8px 0", color: c.muted }}>{BASIS_LABEL[r.basis] ?? r.basis}</td>
                  <td style={{ padding: "8px 0", color: c.muted }}>
                    {r.source ? (SOURCE_LABEL[r.source] ?? r.source) : "—"}
                    {r.note && <div className="bpm-t-help">{r.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" onClick={() => { setForm(form === "granted" ? null : "granted"); setMsg(null); }} disabled={busy}>Record consent</Button>
            <Button size="sm" onClick={() => { setForm(form === "withdrawn" ? null : "withdrawn"); setMsg(null); }} disabled={busy}>Record withdrawal</Button>
          </div>
          <div className="bpm-t-help" style={{ marginTop: 4 }}>Use these to write down what the person told you, for example on a phone call. Nothing is sent to them.</div>

          {form && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0 14px" }}>
                <Field label="Channel" hint="Where they agreed to be contacted.">
                  <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                    {CHANNELS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </Select>
                </Field>
                <Field label="About" hint="One topic, or everything.">
                  <Select value={topic} onChange={(e) => setTopic(e.target.value)}>
                    <option value="">All topics</option>
                    {consent.topics.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </Select>
                </Field>
                {form === "granted" && (
                  <Field label="Basis" hint={BASIS_HINT[basis] ?? ""}>
                    <Select value={basis} onChange={(e) => setBasis(e.target.value)}>
                      {consent.bases.map((b) => <option key={b} value={b}>{BASIS_LABEL[b] ?? b}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
              <Field
                label="How you got it"
                required
                hint={form === "granted" ? "In your own words, for example: agreed by phone on 20 Oct." : "In your own words, for example: asked by phone on 20 Oct to stop."}
              >
                <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={form === "granted" ? "Agreed by phone on 20 Oct" : "Asked by phone on 20 Oct to stop"} />
              </Field>
              <Button size="sm" variant="primary" loading={busy} disabled={busy || note.trim().length < 3} onClick={submit}>
                {form === "granted" ? "Save consent" : "Save withdrawal"}
              </Button>
            </div>
          )}
        </div>
      )}

      {msg && (
        <div role={msg.tone === "err" ? "alert" : "status"} className="bpm-t-help" style={{ marginTop: 12, color: msg.tone === "err" ? "var(--err-ink)" : c.muted }}>{msg.text}</div>
      )}

      {consent.history.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Button size="sm" variant="quiet" onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Hide history" : "Show history"}</Button>
          {showHistory && (
            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {consent.history.map((h, i) => (
                <li key={i} className="bpm-t-help">
                  {fmt(h.at)} · {h.status === "granted" ? "Agreed" : "Withdrew"} · {CHANNEL_LABEL[h.channel] ?? h.channel} · {topicLabel(h.topic ?? "")} · {SOURCE_LABEL[h.source] ?? h.source}{h.note ? ` — ${h.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
