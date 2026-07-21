"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { CheckIcon } from "@/components/Icons";

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
  assets: AssetInfo[];
};

// Multi-select relationship editor for a case's linked assets. Plain field
// values (equipment_label, complaint, symptom, notes) moved to ObjectSections
// -- asset_ids stays here because it's a many-to-many picker with an
// account-scoped search, not something the generic field editor supports.
export default function CaseAssetsPanel({ caseId, accountId, assets }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [assetIds, setAssetIds] = useState<string[]>(assets.map((a) => a.id));
  const [assetInfo, setAssetInfo] = useState<Record<string, AssetInfo>>(
    Object.fromEntries(assets.map((a) => [a.id, a])),
  );
  const [accountAssets, setAccountAssets] = useState<AssetInfo[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    setLoaded(true);
    fetch(`/api/assets?account_id=${accountId}`)
      .then((r) => r.json())
      .then((rows: AssetInfo[]) => {
        setAccountAssets(rows);
        setAssetInfo((prev) => ({ ...Object.fromEntries(rows.map((a) => [a.id, a])), ...prev }));
      })
      .catch(() => {});
  }, [loaded, accountId]);

  function toggleAsset(assetId: string) {
    setAssetIds((ids) => (ids.includes(assetId) ? ids.filter((id) => id !== assetId) : [...ids, assetId]));
    setSaved(false);
  }

  function save(nextIds: string[]) {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_ids: nextIds }),
      });
      if (res.ok) { setSaved(true); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  const unselectedAccountAssets = accountAssets.filter((a) => !assetIds.includes(a.id));

  return (
    <div style={{ background: c.panel, border: `1px solid ${c.line}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        Assets
        {saved && <span style={{ color: "#1d9e75", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 3, textTransform: "none" }}><CheckIcon size={11} color="#1d9e75" /> Saved</span>}
      </div>

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
                  type="button"
                  onClick={() => { const next = assetIds.filter((x) => x !== id); toggleAsset(id); save(next); }}
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
                  type="checkbox" checked={false}
                  onChange={() => { const next = [...assetIds, a.id]; toggleAsset(a.id); save(next); }}
                  style={{ width: 13, height: 13, accentColor: c.accent, flexShrink: 0 }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assetLabel(a) || a.name}</span>
              </label>
            ))
          )}
        </div>
      )}

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626", marginTop: 10 }}>
          {error}
        </div>
      )}
      {pending && <div style={{ fontSize: 11, color: c.hint, marginTop: 8 }}>Saving…</div>}
    </div>
  );
}
