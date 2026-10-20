"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CHANGE_KIND_LABEL, EFFORT_BANDS, EFFORT_LABEL, RATING_LABEL, RATINGS, type StudyBundle } from "@/lib/studio/types";

export type ReviewRequest = {
  id: string; version: number; status: string; contact_name: string | null; contact_email: string | null;
  email_status: string; email_note: string | null; notes: string | null; created_at: string;
};

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, marginBottom: 14 };
const h2: React.CSSProperties = { margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "#111827" };
const cell: React.CSSProperties = { padding: "8px 10px", borderTop: "1px solid #eef0f3", verticalAlign: "top", fontSize: 13 };

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const j = await res.json().catch(() => ({}));
  return (j as { error?: string }).error ?? "Could not save.";
}

export default function ReviewClient({ studyId, bundle, labels, requests, reviewed }: {
  studyId: string; bundle: StudyBundle; labels: Record<string, string>; requests: ReviewRequest[]; reviewed: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState(bundle.study.review_note ?? "");
  const [busy, setBusy] = useState(false);
  const base = `/api/admin/studies/${studyId}`;
  const stepName = new Map(bundle.steps.map((s) => [s.id, s.name]));

  async function act(fn: () => Promise<string | null>, ok: string) {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    setMsg(err ?? ok);
    if (!err) router.refresh();
  }

  const warnCount = bundle.fit.reduce((a, f) => a + f.warnings.length + (f.rating === "needs_review" ? 1 : 0), 0);

  return (
    <div>
      {msg && <p role="status" style={{ fontSize: 13, fontWeight: 600 }}>{msg}</p>}

      <section style={card}>
        <h2 style={h2}>Requests</h2>
        {requests.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Not sent to BPMSquare yet.</p>}
        {requests.map((r) => <RequestRow key={r.id} r={r} busy={busy} onSave={(status, notes) => act(() => send(base, "PATCH", { request: { id: r.id, status, notes } }), "Request saved.")} />)}
      </section>

      <section style={card}>
        <h2 style={h2}>Fit report ({bundle.fit.length} rows, {warnCount} to look at)</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <tbody>
              {bundle.steps.map((s) => {
                const f = bundle.fit.find((x) => x.step_id === s.id);
                if (!f) return null;
                return <FitEditRow key={f.id} name={s.name} how={s.how_today} f={f} labels={labels} busy={busy}
                  onSave={(rating, why) => act(() => send(base, "PATCH", { fit: { id: f.id, rating, why } }), "Row saved and marked reviewed.")} />;
              })}
            </tbody>
          </table>
        </div>
        {bundle.study.noticed.length > 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>Noticed: {bundle.study.noticed.join(" · ")}</p>}
      </section>

      <section style={card}>
        <h2 style={h2}>Changes</h2>
        {bundle.changes.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>None.</p>}
        {bundle.changes.map((c) => (
          <div key={c.id} style={{ ...cell, display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, opacity: c.kept ? 1 : 0.55 }}>
            <div>
              <b>{c.title}</b> <span style={{ color: "#6b7280" }}>· {CHANGE_KIND_LABEL[c.kind]}{c.kept ? "" : " · hidden by client"}{c.client_added ? " · added by client" : ""}</span>
              <div>{c.plain}</div>
              <div style={{ color: "#6b7280", fontSize: 12 }}>For: {c.step_ids.map((i) => stepName.get(i)).filter(Boolean).join(" · ") || "n/a"}{c.extension_hook ? ` · hook: ${c.extension_hook}` : ""}{c.connector ? ` · connector: ${c.connector}` : ""}</div>
            </div>
            <label style={{ fontSize: 12 }}>Band{" "}
              <select defaultValue={c.effort_band} disabled={busy} className="bpm-input" style={{ width: "auto" }}
                onChange={(e) => void act(() => send(base, "PATCH", { change: { id: c.id, effort_band: e.target.value } }), "Band changed.")}>
                {EFFORT_BANDS.map((b) => <option key={b} value={b}>{EFFORT_LABEL[b]}</option>)}
              </select>
            </label>
          </div>
        ))}
      </section>

      <section style={card}>
        <h2 style={h2}>Mark reviewed</h2>
        <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "#6b7280" }}>
          The client sees every line as Reviewed by BPMSquare and the Draft banner goes away. {reviewed ? "This study is already marked reviewed; marking again updates the note." : ""}
        </p>
        <textarea className="bpm-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for the team (not shown to the client)" style={{ width: "100%", marginBottom: 8 }} />
        <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" disabled={busy} onClick={() => void act(() => send(`${base}/review`, "POST", { note }), "Marked reviewed.")}>Mark reviewed</button>
      </section>
    </div>
  );
}

function RequestRow({ r, busy, onSave }: { r: ReviewRequest; busy: boolean; onSave: (status: string, notes: string) => void }) {
  const [status, setStatus] = useState(r.status);
  const [notes, setNotes] = useState(r.notes ?? "");
  return (
    <div style={{ ...cell, display: "grid", gap: 6 }}>
      <div><b>Version {r.version}</b> · {new Date(r.created_at).toLocaleString("en-GB")} · {r.contact_name ?? "no name"} {r.contact_email ? `<${r.contact_email}>` : ""}</div>
      <div style={{ color: "#6b7280", fontSize: 12 }}>Email: {r.email_status}{r.email_note ? ` (${r.email_note})` : ""}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select className="bpm-input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "auto" }} aria-label="Request status">
          {["new", "contacted", "accepted", "rescoped", "declined"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="bpm-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" aria-label="Notes" style={{ flex: 1, minWidth: 180 }} />
        <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" disabled={busy} onClick={() => onSave(status, notes)}>Save</button>
      </div>
    </div>
  );
}

function FitEditRow({ name, how, f, labels, busy, onSave }: {
  name: string; how: string | null; f: StudyBundle["fit"][number]; labels: Record<string, string>; busy: boolean; onSave: (rating: string, why: string) => void;
}) {
  const [rating, setRating] = useState<string>(f.rating);
  const [why, setWhy] = useState(f.why);
  return (
    <tr>
      <td style={{ ...cell, width: "28%" }}><b>{name}</b><div style={{ color: "#6b7280", fontSize: 12 }}>{how ?? ""}</div></td>
      <td style={{ ...cell, width: 150 }}>
        <select className="bpm-input" value={rating} onChange={(e) => setRating(e.target.value)} aria-label={`Rating for ${name}`}>
          {RATINGS.map((r) => <option key={r} value={r}>{RATING_LABEL[r]}</option>)}
        </select>
        {f.reviewed && <div style={{ color: "#173404", fontSize: 11.5, marginTop: 2 }}>reviewed</div>}
      </td>
      <td style={cell}>
        <div style={{ fontSize: 12, color: "#6b7280" }}>{f.capability_ids.map((c) => labels[c] ?? c).join(", ") || "no citation"} · {f.confidence}</div>
        <input className="bpm-input" value={why} onChange={(e) => setWhy(e.target.value)} aria-label={`Why for ${name}`} style={{ width: "100%", marginTop: 4 }} />
        {f.warnings.map((w) => <div key={w} style={{ color: "#633806", background: "#faeeda", borderRadius: 6, padding: "3px 6px", fontSize: 12, marginTop: 4 }}>{w}</div>)}
      </td>
      <td style={{ ...cell, width: 70 }}><button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-sm" disabled={busy} onClick={() => onSave(rating, why)}>Save</button></td>
    </tr>
  );
}
