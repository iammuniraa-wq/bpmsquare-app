"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Opt } from "@/components/ui/Opt";
import { cx, studio as styles } from "@/components/marketing/StudioKit";
import { WA_SETUP_TIPS } from "@/lib/marketing/whatsapp/tips";
import type { IdentityView } from "@/lib/marketing/whatsapp/identity";

// The admin's side of WhatsApp: the number customers see, which provider sends, the address and signing secret the
// provider calls back, and "Match my contacts' numbers". Nothing secret is ever shown after the moment it is made.

type ProviderChoice = { id: string; label: string; fields: { key: string; label: string; secret: boolean }[] };

export default function SetupClient({ identity, providers, origin, canEdit, isDemo }: {
  identity: IdentityView | null; providers: ProviderChoice[]; origin: string; canEdit: boolean; isDemo: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<IdentityView | null>(identity);
  const [provider, setProvider] = useState(identity?.provider ?? providers[0]?.id ?? "sandbox");
  const [number, setNumber] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "stop"; text: string } | null>(null);
  const [match, setMatch] = useState<string | null>(null);

  const chosen = providers.find((p) => p.id === provider);
  const url = view ? `${origin || "https://<your workspace address>"}/api/inbound/whatsapp/${view.webhookKey}` : "";

  async function save(extra: { rotate_secret?: boolean; status?: "active" | "disabled" } = {}) {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/whatsapp/identity", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, ...(number.trim() ? { display_number: number } : {}), credentials: creds, ...extra }),
    });
    const j = (await res.json().catch(() => ({}))) as { identity?: IdentityView; secret?: string | null; error?: string };
    setBusy(false);
    if (!res.ok || !j.identity) { setMsg({ tone: "stop", text: j.error ?? "Could not save." }); return; }
    setView(j.identity); setNumber(""); setCreds({});
    if (j.secret) setSecret(j.secret);
    setMsg({ tone: "ok", text: "Saved." });
    router.refresh();
  }

  async function matchNumbers() {
    setBusy(true); setMatch("Working…");
    let after: string | null = null;
    let scanned = 0; let matched = 0;
    for (let i = 0; i < 40; i++) {
      const res = await fetch("/api/whatsapp/match-numbers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ after }) });
      const j = (await res.json().catch(() => ({}))) as { scanned?: number; matched?: number; last?: string | null; done?: boolean; error?: string };
      if (!res.ok) { setMatch(j.error ?? "Could not match the numbers."); setBusy(false); return; }
      scanned += j.scanned ?? 0; matched += j.matched ?? 0;
      if (j.done) break;
      after = j.last ?? null;
      setMatch(`Checked ${scanned} people…`);
    }
    setMatch(`Checked ${scanned} people. ${matched} have a number WhatsApp can use.`);
    setBusy(false);
  }

  return (
    <div className={styles.accent}>
      <Card title="Number and provider" padding={16}>
        <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
          {isDemo && <div className={cx(styles.banner, styles.info)}>This is a demo workspace: messages are only logged (or sent to the workspace&apos;s test number), never to a customer.</div>}
          <Opt label="Provider" info={WA_SETUP_TIPS.provider} htmlFor="waProvider">
            <select id="waProvider" className={styles.select} value={provider} disabled={!canEdit || busy} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Opt>
          <Opt label={`Business number${view?.maskedNumber ? ` (now ${view.maskedNumber})` : ""}`} info={WA_SETUP_TIPS.number} htmlFor="waNumber">
            <input id="waNumber" className={styles.field} value={number} disabled={!canEdit || busy} placeholder="+966 5X XXX XXXX" inputMode="tel" autoComplete="off" onChange={(e) => setNumber(e.target.value)} />
          </Opt>
          {chosen?.fields.map((f) => (
            <div key={f.key}>
              <label className={styles.lbl} htmlFor={`waCred${f.key}`}>{f.label}</label>
              <input id={`waCred${f.key}`} className={styles.field} type={f.secret ? "password" : "text"} autoComplete="off" value={creds[f.key] ?? ""} disabled={!canEdit || busy}
                placeholder={view?.filled.includes(f.key) ? "Saved. Leave blank to keep it." : ""} onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))} />
            </div>
          ))}
          <div className={styles.row}>
            <Button variant="primary" disabled={!canEdit || busy} loading={busy} onClick={() => void save()}>{view ? "Save" : "Set up"}</Button>
            {view && <Button disabled={!canEdit || busy} onClick={() => void save({ status: view.status === "active" ? "disabled" : "active" })}>{view.status === "active" ? "Turn the number off" : "Turn the number on"}</Button>}
          </div>
          {msg && <div className={cx(styles.check, msg.tone === "stop" && styles.stop)} role="status">{msg.text}</div>}
        </div>
      </Card>

      {view && (
        <Card title="Replies and delivery updates" info={WA_SETUP_TIPS.replies} padding={16}>
          <div style={{ display: "grid", gap: 10, maxWidth: 640 }}>
            <input className={styles.field} readOnly value={url} aria-label="Address for your provider to call" onFocus={(e) => e.currentTarget.select()} />
            {secret ? (
              <div className={cx(styles.check, styles.confirm)} role="status">
                Signing secret (shown once, copy it now): <code style={{ overflowWrap: "anywhere" }}>{secret}</code>
              </div>
            ) : (
              <p className={styles.help}>{view.hasWebhookSecret ? "Signing secret: saved, cannot be shown again" : "Signing secret: none yet"}</p>
            )}
            <div className={styles.row}>
              <Button disabled={!canEdit || busy} onClick={() => void save({ rotate_secret: true })}>Make a new signing secret</Button>
            </div>
          </div>
        </Card>
      )}

      <Card title="Match my contacts' numbers" info={WA_SETUP_TIPS.match} padding={16}>
        <div style={{ display: "grid", gap: 10, maxWidth: 640 }}>
          <div className={styles.row}>
            <Button disabled={!canEdit || busy} onClick={() => void matchNumbers()}>Match numbers</Button>
            {match && <span className={styles.help} role="status">{match}</span>}
          </div>
        </div>
      </Card>
    </div>
  );
}
