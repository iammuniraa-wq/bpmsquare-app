"use client";

import { useState } from "react";

// Where "Talk to us" requests are emailed. A platform setting: nothing is hard-coded.
export default function NotifySettings({ initialAddress, source }: { initialAddress: string; source: "setting" | "env" | "none" }) {
  const [address, setAddress] = useState(initialAddress);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/admin/studies/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notify_email: address }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? "Saved." : (j.error ?? "Could not save."));
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, marginBottom: 16, maxWidth: 560 }}>
      <label htmlFor="notify" style={{ display: "block", fontSize: 13, fontWeight: 600 }}>Talk to us: email the requests to</label>
      <p style={{ margin: "2px 0 8px", fontSize: 12, color: "#6b7280" }}>
        {source === "env" && !initialAddress ? "" : source === "env" ? "Currently from the PROCESS_STUDIO_NOTIFY_EMAIL setting of the server. " : ""}
        {source === "none" ? "No address is set, so requests only appear in this list. " : ""}
        Requests from a demo workspace are redirected to that workspace's own email-output inbox.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <input id="notify" type="email" className="bpm-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="studio@yourcompany.com" style={{ flex: 1 }} />
        <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" disabled={busy} onClick={() => void save()}>Save</button>
      </div>
      {msg && <p role="status" style={{ margin: "6px 0 0", fontSize: 12 }}>{msg}</p>}
    </div>
  );
}
