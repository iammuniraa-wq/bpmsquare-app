"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import { ABM_TIERS, TIER_LABEL, type AbmTier } from "@/lib/abm/types";
import Modal from "./Modal";

type Item = { id: string; name: string; city?: string | null };
type Mode = "name" | "group" | "segment";

/**
 * "+ Add accounts": choose companies by name, or copy a marketing target
 * group or a Coverage segment. A group or segment is read ONCE and copied into
 * the program (a list is a commitment and never changes by itself); the preview
 * says how many would be added before anything is written.
 */
export default function AddAccountsButton({ programId, defaultTier }: { programId: string; defaultTier: AbmTier }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("name");
  const [tier, setTier] = useState<AbmTier>(defaultTier);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Item[]>([]);
  const [picked, setPicked] = useState<Item[]>([]);
  const [sources, setSources] = useState<Item[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [preview, setPreview] = useState<{ would_add: number; already_in: number; capped: number; sample: Item[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || mode !== "name") return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/abm/lookup?kind=accounts&q=${encodeURIComponent(q)}`).catch(() => null);
      if (res?.ok) setFound(((await res.json()) as { items: Item[] }).items);
    }, 200);
    return () => clearTimeout(t);
  }, [open, mode, q]);

  useEffect(() => {
    if (!open || mode === "name") return;
    setSourceId(""); setPreview(null);
    fetch(`/api/abm/lookup?kind=${mode === "group" ? "groups" : "segments"}`).then((r) => r.json()).then((j: { items: Item[] }) => setSources(j.items ?? [])).catch(() => setSources([]));
  }, [open, mode]);

  const body = () => (mode === "name" ? { account_ids: picked.map((p) => p.id), tier } : mode === "group" ? { target_group_id: sourceId, tier } : { segment_id: sourceId, tier });
  const ready = mode === "name" ? picked.length > 0 : !!sourceId;

  async function doPreview() {
    setBusy(true); setError("");
    const res = await fetch(`/api/abm/programs/${programId}/targets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body(), preview: true }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? "Could not preview that list."); return; }
    setPreview(j);
  }

  async function add() {
    setBusy(true); setError("");
    const res = await fetch(`/api/abm/programs/${programId}/targets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? "Could not add those accounts."); return; }
    setOpen(false); setPicked([]); setPreview(null); setQ("");
    router.refresh();
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>+ Add accounts</Button>
      {open && (
        <Modal title="Add accounts to this program" onClose={() => setOpen(false)} width={520}>
          <Field label="Choose companies" style={{ marginBottom: 12 }}>
            <Select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setPreview(null); }}>
              <option value="name">By name</option>
              <option value="group">From a marketing target group</option>
              <option value="segment">From a Coverage segment</option>
            </Select>
          </Field>

          {mode === "name" ? (
            <div style={{ marginBottom: 12 }}>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts by name…" aria-label="Search accounts" autoFocus />
              {picked.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {picked.map((p) => (
                    <button key={p.id} type="button" onClick={() => setPicked((cur) => cur.filter((x) => x.id !== p.id))} style={{ font: "inherit", fontSize: 12, padding: "3px 9px", borderRadius: 999, border: `1px solid ${c.accent}`, background: c.accentbg, color: c.accent, cursor: "pointer" }} aria-label={`Remove ${p.name}`}>{p.name} ×</button>
                  ))}
                </div>
              )}
              <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, maxHeight: 190, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                {found.filter((f) => !picked.some((p) => p.id === f.id)).map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => setPicked((cur) => [...cur, f])} style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", fontSize: 13, padding: "7px 10px", background: "transparent", border: 0, cursor: "pointer", color: c.ink }}>
                      {f.name}{f.city ? <span style={{ color: c.hint }}> · {f.city}</span> : null}
                    </button>
                  </li>
                ))}
                {found.length === 0 && <li style={{ padding: "8px 10px", color: c.hint, fontSize: 13 }}>No accounts found.</li>}
              </ul>
            </div>
          ) : (
            <Field label={mode === "group" ? "Target group" : "Segment"} hint="The list is copied into the program once. It does not change by itself afterwards.">
              <Select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setPreview(null); }}>
                <option value="">— Choose —</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          )}

          <Field label="Tier for these companies" style={{ marginBottom: 12 }}>
            <Select value={tier} onChange={(e) => setTier(e.target.value as AbmTier)}>{ABM_TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</Select>
          </Field>

          {preview && (
            <div style={{ background: c.panel2, borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 12 }}>
              <b>{preview.would_add}</b> would be added{preview.already_in > 0 ? `, ${preview.already_in} already in this program` : ""}.
              {preview.capped > 0 && <div style={{ color: c.muted }}>Only the first 200 are added at a time; run it again for the rest.</div>}
              {preview.sample.length > 0 && <div style={{ color: c.muted, marginTop: 4 }}>{preview.sample.map((s) => s.name).join(", ")}{preview.would_add > preview.sample.length ? "…" : ""}</div>}
            </div>
          )}
          {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13, marginBottom: 10 }}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            {mode !== "name" && !preview && <Button disabled={!ready || busy} loading={busy} onClick={doPreview}>Preview</Button>}
            <Button variant="primary" disabled={!ready || busy || (mode !== "name" && !preview) || (preview?.would_add === 0)} loading={busy && !!preview} onClick={add}>Add accounts</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
