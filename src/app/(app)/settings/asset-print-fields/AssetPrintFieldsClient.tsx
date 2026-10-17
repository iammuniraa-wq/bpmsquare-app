"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";

// ── Helpers ───────────────────────────────────────────────────────────────────

function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback(() => {
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [saved, flash];
}

const ALL_ASSET_FIELDS: { value: string; label: string; example: string }[] = [
  { value: "name",   label: "Equipment name",  example: "75 kW Induction Motor" },
  { value: "kind",   label: "Type",             example: "Motor" },
  { value: "make",   label: "Make / OEM",       example: "Crompton Greaves" },
  { value: "model",  label: "Model / Frame",    example: "ND315S-2" },
  { value: "rating", label: "Rating",           example: "75 kW · 415V" },
  { value: "rpm",    label: "RPM",              example: "1480" },
  { value: "serial", label: "Serial no.",       example: "CG-75-2291" },
  { value: "notes",  label: "Remarks",          example: "Stator rewound 2023" },

  // Motor/generator nameplate fields — see FIELD_REGISTRY.asset (src/lib/fieldRegistry.ts).
  { value: "frame_type",         label: "Frame / Type",         example: "4B 206-02H" },
  { value: "insulation_class",   label: "Insulation class",     example: "F" },
  { value: "connection",         label: "Connection",           example: "Star Connection" },
  { value: "duty",               label: "Duty",                 example: "S1" },
  { value: "ambient_temp",       label: "Ambient temp.",        example: "50°C" },
  { value: "output_kw",          label: "Output (kW)",          example: "2200" },
  { value: "stator_voltage",     label: "Stator voltage",       example: "11000" },
  { value: "stator_current",     label: "Stator current",       example: "133" },
  { value: "excitation_voltage", label: "Excitation voltage",   example: "54" },
  { value: "excitation_current", label: "Excitation current",   example: "295" },
  { value: "frequency",          label: "Frequency",            example: "50" },
];

export default function AssetPrintFieldsClient({ initialAssetFields, assetCustomFields = [] }: {
  initialAssetFields: string[];
  /** Tenant-defined custom fields for object_type "asset" (Settings -> Custom Fields), merged
   *  into the picker alongside the fixed base Asset columns. */
  assetCustomFields?: { value: string; label: string }[];
}) {
  const allAssetFields = [
    ...ALL_ASSET_FIELDS,
    ...assetCustomFields.map((f) => ({ value: f.value, label: f.label, example: "" })),
  ];

  const [assetFields, setAssetFields] = useState<string[]>(initialAssetFields);
  const [savingFields, setSavingFields] = useState(false);
  const [savedFields, flashFields] = useSavedFlash();
  const { dirty, markSaved } = useSettingsDirty(assetFields);

  function toggleAssetField(value: string) {
    setAssetFields((p) => p.includes(value) ? p.filter((f) => f !== value) : [...p, value]);
  }

  async function saveAssetFields() {
    setSavingFields(true);
    const res = await fetch("/api/settings/asset-print-fields", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(assetFields),
    });
    setSavingFields(false);
    if (res.ok) { markSaved(); flashFields(); }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      {/* ── Asset fields on quote print ───────────────────────────────────── */}
      <div className="bpm-t-section" style={{ marginBottom: 8 }}>
        Equipment details on quote print
      </div>
      <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: c.muted, marginBottom: 16, lineHeight: 1.6 }}>
          Choose which equipment fields appear in the <strong>Equipment Details</strong> section on the printed quote.
          The section is hidden when no fields are selected.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
          {allAssetFields.map((f) => (
            <label key={f.value} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: 8, border: `1px solid ${assetFields.includes(f.value) ? c.accent : c.line}`, background: assetFields.includes(f.value) ? `${c.accent}0d` : c.panel }}>
              <input
                type="checkbox"
                checked={assetFields.includes(f.value)}
                onChange={() => toggleAssetField(f.value)}
                style={{ marginTop: 2, cursor: "pointer", accentColor: c.accent }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{f.label}</div>
                {f.example && <div className="bpm-t-help" style={{ marginTop: 1 }}>e.g. {f.example}</div>}
              </div>
            </label>
          ))}
        </div>
      </div>

      <SettingsSave dirty={dirty} saving={savingFields} saved={savedFields} onSave={saveAssetFields} />
    </div>
  );
}
