"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { Pencil, CheckIcon } from "@/components/Icons";

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 7,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
};
const fw: React.CSSProperties = { marginBottom: 12 };

type AssetInfo = { id: string; name: string; make: string | null; model: string | null; rating: string | null; serial: string | null };

function assetLabel(a: AssetInfo): string {
  return [
    [a.make, a.model ?? a.name].filter(Boolean).join(" "),
    a.rating,
    a.serial,
  ].filter(Boolean).join(" · ").trim();
}

type Props = {
  caseId: string;
  accountId: string;
  equipmentLabel: string;
  complaint: string;
  symptom: string | null;
  notes: string | null;
  assets: AssetInfo[];
};

export default function CaseCoreEditPanel({ caseId, accountId, equipmentLabel, complaint, symptom, notes, assets }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    equipment_label: equipmentLabel,
    complaint,
    symptom: symptom ?? "",
    notes: notes ?? "",
  });
  const [assetIds, setAssetIds] = useState<string[]>(assets.map((a) => a.id));
  const [assetInfo, setAssetInfo] = useState<Record<string, AssetInfo>>(
    Object.fromEntries(assets.map((a) => [a.id, a])),
  );
  const [accountAssets, setAccountAssets] = useState<AssetInfo[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const set = (k: "equipment_label" | "complaint" | "symptom" | "notes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (!open || accountAssets.length > 0) return;
    fetch(`/api/assets?account_id=${accountId}`)
      .then((r) => r.json())
      .then((rows: AssetInfo[]) => {
        setAccountAssets(rows);
        setAssetInfo((prev) => ({ ...Object.fromEntries(rows.map((a) => [a.id, a])), ...prev }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  function toggleAsset(assetId: string) {
    setAssetIds((ids) => (ids.includes(assetId) ? ids.filter((id) => id !== assetId) : [...ids, assetId]));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.equipment_label.trim() || !form.complaint.trim()) {
      setError("Equipment and complaint are required"); return;
    }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipment_label: form.equipment_label,
          complaint: form.complaint,
          symptom: form.symptom || null,
          notes: form.notes,
          asset_ids: assetIds,
        }),
      });
      if (res.ok) { setSaved(true); setOpen(false); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setSaved(false); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          background: c.panel2, color: c.muted, borderRadius: 7,
          padding: "6px 12px", fontSize: 12.5, fontWeight: 500,
          border: `1px solid ${c.line}`, cursor: "pointer",
        }}
      >
        {saved ? <><CheckIcon size={13} color={c.muted} /> Saved</> : <><Pencil size={13} color={c.muted} /> Edit case details</>}
      </button>
    );
  }

  const unselectedAccountAssets = accountAssets.filter((a) => !assetIds.includes(a.id));

  return (
    <form onSubmit={handleSave} style={{
      background: c.panel, border: `1px solid ${c.line}`, borderRadius: 12, padding: 16, marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
        Edit case details
      </div>
      <div style={fw}>
        <label style={lbl}>Equipment *</label>
        <input style={inp} value={form.equipment_label} onChange={set("equipment_label")} placeholder="e.g. Crompton 75 kW 3-Ph IM · CG-75-2291" />
      </div>
      <div style={fw}>
        <label style={lbl}>Complaint *</label>
        <textarea style={{ ...inp, minHeight: 72, resize: "vertical" }} value={form.complaint} onChange={set("complaint")} placeholder="Customer-reported symptom…" />
      </div>
      <div style={fw}>
        <label style={lbl}>Symptom</label>
        <textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={form.symptom} onChange={set("symptom")} placeholder="Observed symptom, e.g. bearing noise, tripping on load…" />
      </div>

      <div style={fw}>
        <label style={lbl}>Assets</label>
        {assetIds.length === 0 && (
          <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 6 }}>No assets linked</div>
        )}
        {assetIds.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {assetIds.map((id) => {
              const a = assetInfo[id];
              return (
                <div key={id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  padding: "6px 10px", borderRadius: 7, background: c.panel2, border: `1px solid ${c.line}`,
                }}>
                  <span style={{ fontSize: 12, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a ? (assetLabel(a) || a.name) : id}
                  </span>
                  <button
                    type="button" onClick={() => toggleAsset(id)}
                    style={{ background: "none", border: "none", color: c.hint, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }}
                    aria-label="Remove asset"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {!pickerOpen ? (
          <button
            type="button" onClick={() => setPickerOpen(true)}
            style={{ background: "none", border: `1px dashed ${c.line}`, borderRadius: 7, padding: "6px 10px", fontSize: 12, color: c.accent, cursor: "pointer" }}
          >
            + Add asset
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto", border: `1px solid ${c.line}`, borderRadius: 7, padding: 8 }}>
            {unselectedAccountAssets.length === 0 ? (
              <span style={{ fontSize: 11.5, color: c.hint }}>No more assets on file for this account</span>
            ) : (
              unselectedAccountAssets.map((a) => (
                <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "5px 8px", borderRadius: 6, fontSize: 12, color: c.ink }}>
                  <input
                    type="checkbox" checked={false} onChange={() => toggleAsset(a.id)}
                    style={{ width: 13, height: 13, accentColor: c.accent, flexShrink: 0 }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assetLabel(a) || a.name}</span>
                </label>
              ))
            )}
          </div>
        )}
      </div>

      <div style={fw}>
        <label style={lbl}>Internal notes</label>
        <textarea style={{ ...inp, minHeight: 64, resize: "vertical" }} value={form.notes} onChange={set("notes")} placeholder="Condition on arrival, accessories received…" />
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626", marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={pending} style={{
          padding: "7px 16px", borderRadius: 7, border: "none",
          background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
        }}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{
          padding: "7px 12px", borderRadius: 7, border: `1px solid ${c.line}`,
          background: "none", color: c.muted, fontWeight: 500, fontSize: 13, cursor: "pointer",
        }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
