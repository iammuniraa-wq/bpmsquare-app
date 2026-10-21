"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import { c } from "@/lib/theme";
import type { ContactConsent } from "@/lib/marketing/contactConsent";
import { BASIS_TIP, CONSENT_CARD_TIPS, consentCardTip, consentRowTip } from "@/lib/marketing/contactCardTips";

const CHANNELS: { id: string; label: string }[] = [
  { id: "email", label: "Email" }, { id: "whatsapp", label: "WhatsApp" }, { id: "sms", label: "SMS" }, { id: "phone", label: "Phone calls" },
];
const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((x) => [x.id, x.label]));
const BASIS_LABEL: Record<string, string> = {
  consent: "They agreed", existing_customer: "Existing customer", contract: "Contract", legitimate_interest: "Legitimate interest",
};
const SOURCE_LABEL: Record<string, string> = {
  rep: "Recorded by a person", form: "A form", preference_centre: "Their preferences page", unsubscribe_link: "An unsubscribe link",
  import: "A file import", api: "An integration", provider_webhook: "The email service",
};
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const HISTORY_SHOWN = 5;

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
  const [allHistory, setAllHistory] = useState(false);

  if (!consent.available) {
    return (
      <Card title="Consent" padding={0}>
        <EmptyState title="Waiting for a database update" text="This card fills in once the update has been applied." />
      </Card>
    );
  }

  const topicLabel = (key: string) => (key === "" ? "Any consent topic" : consent.topics.find((t) => t.key === key)?.label ?? key);

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
      setMsg({ tone: "ok", text: form === "granted" ? "Recorded that they agreed. Nothing was sent to them." : "Recorded that they withdrew. Nothing was sent to them." });
      setForm(null); setNote("");
      router.refresh();
    } catch {
      setMsg({ tone: "err", text: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const history = allHistory ? consent.history : consent.history.slice(0, HISTORY_SHOWN);

  return (
    <Card title="Consent" info={consentCardTip(consent.jurisdictionLabel)}>
      {consent.rows.length === 0 && (consent.waiting ?? []).length === 0 ? (
        <p style={{ margin: 0, fontSize: 13.5, color: c.ink }}>No answer recorded yet, so we do not email this person about marketing unless your workspace allows it for existing customers.</p>
      ) : (
        <>
          <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["Channel", "Consent topic", "Answer", "Since", "Basis", "How we know"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px 6px 0", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: c.hint, fontWeight: 600, whiteSpace: "nowrap" }}>
                      {h}{h === "Basis" && <InfoTip label="Basis">{CONSENT_CARD_TIPS.basis}</InfoTip>}
                    </th>
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
                {(consent.waiting ?? []).map((w) => (
                  <tr key={`waiting:${w.channel}:${w.topic}`} style={{ borderTop: `1px solid ${c.line}` }}>
                    <td style={{ padding: "8px 10px 8px 0" }}>{CHANNEL_LABEL[w.channel] ?? w.channel}</td>
                    <td style={{ padding: "8px 10px 8px 0" }}>{topicLabel(w.topic)}</td>
                    <td style={{ padding: "8px 10px 8px 0" }}><StatusPill label={w.expired ? "Did not confirm" : "Waiting for confirmation"} tone={w.expired ? "blue" : "amber"} /></td>
                    <td style={{ padding: "8px 10px 8px 0", color: c.muted, whiteSpace: "nowrap" }}>{fmt(w.since)}</td>
                    <td style={{ padding: "8px 10px 8px 0", color: c.muted }}>Not counted as a yes</td>
                    <td style={{ padding: "8px 0", color: c.muted }}>{SOURCE_LABEL.form}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="bpm-rows-cards" style={{ listStyle: "none", margin: 0, padding: 0, gap: 0 }}>
            {consent.rows.map((r) => (
              <li key={`${r.channel}:${r.topic}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 44, padding: "8px 0", borderTop: `1px solid ${c.line}`, fontSize: 13 }}>
                <span style={{ flex: "1 1 140px", minWidth: 0, fontWeight: 600, color: c.ink }}>
                  {CHANNEL_LABEL[r.channel] ?? r.channel} · {topicLabel(r.topic)}
                </span>
                <StatusPill label={r.status === "granted" ? "Agreed" : "Withdrawn"} tone={r.status === "granted" ? "green" : "red"} />
                <span style={{ color: c.muted, whiteSpace: "nowrap" }}>{fmt(r.since)}</span>
                <InfoTip label={`how we know: ${CHANNEL_LABEL[r.channel] ?? r.channel}, ${topicLabel(r.topic)}`}>
                  {consentRowTip({ basis: BASIS_LABEL[r.basis] ?? r.basis, source: r.source ? (SOURCE_LABEL[r.source] ?? r.source) : null, note: r.note })}
                </InfoTip>
              </li>
            ))}
            {(consent.waiting ?? []).map((w) => (
              <li key={`waiting:${w.channel}:${w.topic}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 44, padding: "8px 0", borderTop: `1px solid ${c.line}`, fontSize: 13 }}>
                <span style={{ flex: "1 1 140px", minWidth: 0, fontWeight: 600, color: c.ink }}>
                  {CHANNEL_LABEL[w.channel] ?? w.channel} · {topicLabel(w.topic)}
                </span>
                <StatusPill label={w.expired ? "Did not confirm" : "Waiting for confirmation"} tone={w.expired ? "blue" : "amber"} />
                <span style={{ color: c.muted, whiteSpace: "nowrap" }}>{fmt(w.since)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {canEdit && (
        <div className="bpm-tap" style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" onClick={() => { setForm(form === "granted" ? null : "granted"); setMsg(null); }} disabled={busy}>Record consent</Button>
            <Button size="sm" onClick={() => { setForm(form === "withdrawn" ? null : "withdrawn"); setMsg(null); }} disabled={busy}>Record withdrawal</Button>
          </div>

          {form && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0 14px" }}>
                <Field label="Channel" info={CONSENT_CARD_TIPS.channel}>
                  <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                    {CHANNELS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </Select>
                </Field>
                <Field label="Consent topic" info={CONSENT_CARD_TIPS.consentTopic}>
                  <Select value={topic} onChange={(e) => setTopic(e.target.value)}>
                    <option value="">Any consent topic</option>
                    {consent.topics.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </Select>
                </Field>
                {form === "granted" && (
                  <Field label="Basis" info={BASIS_TIP[basis] ?? CONSENT_CARD_TIPS.basis}>
                    <Select value={basis} onChange={(e) => setBasis(e.target.value)}>
                      {consent.bases.map((b) => <option key={b} value={b}>{BASIS_LABEL[b] ?? b}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
              <Field label="How you got it" required info={CONSENT_CARD_TIPS.note}>
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
          <div className="bpm-t-label" style={{ marginBottom: 6 }}>History</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map((h, i) => (
              <li key={i} className="bpm-t-help">
                {fmt(h.at)} · {h.status === "granted" ? "Agreed" : h.status === "pending" ? "Asked to confirm" : "Withdrew"} · {CHANNEL_LABEL[h.channel] ?? h.channel} · {topicLabel(h.topic ?? "")} · {SOURCE_LABEL[h.source] ?? h.source}{h.note ? ` — ${h.note}` : ""}
              </li>
            ))}
          </ul>
          {consent.history.length > HISTORY_SHOWN && (
            <div className="bpm-tap" style={{ marginTop: 6 }}>
              <Button size="sm" variant="quiet" onClick={() => setAllHistory(!allHistory)}>{allHistory ? "Show fewer" : `Show all (${consent.history.length})`}</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
