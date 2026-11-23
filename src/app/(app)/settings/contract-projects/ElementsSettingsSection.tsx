"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { c, pillar } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Input } from "@/components/ui/Input";
import { previewCodes, validatePattern } from "@/lib/elements/pattern";
import { ELEMENT_TIPS } from "@/lib/elements/tips";
import { DEFAULT_LEVEL_NAMES, ELEMENT_LIMITS, type LevelNames } from "@/lib/elements/types";

// Settings > Contract projects > Buildings and element codes: ONE row of settings (the pattern, the longest code, the tolerance) with the level
// names behind a fold. The element types themselves are one more list in the Lists table above (docs/design/pcbs-buildings-elements.md 2.2).
// The preview is worked out here with the same pure rules the server enforces, so what is shown is what will be accepted.

type Loaded = { pattern: string; code_max: number; qty_tolerance_pct: number; level_names: LevelNames };

const card: React.CSSProperties = { background: "var(--card-bg)", border: `1px solid ${c.line}`, borderRadius: "var(--card-radius)", padding: "14px 16px", minWidth: 0 };

export default function ElementsSettingsSection() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pattern, setPattern] = useState("");
  const [codeMax, setCodeMax] = useState("20");
  const [tolerance, setTolerance] = useState("5");
  const [names, setNames] = useState<LevelNames>(DEFAULT_LEVEL_NAMES);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = useCallback((s: Loaded) => {
    setLoaded(s); setPattern(s.pattern); setCodeMax(String(s.code_max)); setTolerance(String(s.qty_tolerance_pct)); setNames(s.level_names);
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch("/api/settings/contract-elements");
      const j = await res.json().catch(() => ({}));
      if (live && res.ok) apply(j as Loaded);
    })();
    return () => { live = false; };
  }, [apply]);

  const check = useMemo(() => validatePattern(pattern, Number(codeMax) || ELEMENT_LIMITS.codeMaxDefault), [pattern, codeMax]);
  const dirty = !!loaded && (pattern !== loaded.pattern || Number(codeMax) !== loaded.code_max || Number(tolerance) !== loaded.qty_tolerance_pct || JSON.stringify(names) !== JSON.stringify(loaded.level_names));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/settings/contract-elements", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern, code_max: Number(codeMax), qty_tolerance_pct: Number(tolerance), level_names: names }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Couldn't save." }); return; }
      apply(j as Loaded); setMsg({ ok: true, text: "Saved." });
    } finally { setBusy(false); }
  }

  if (!loaded) return null;
  return (
    <section style={card} data-guide="cp.settings.elements">
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: c.ink, fontSize: 14, marginBottom: 10 }}>
        Buildings and element codes <InfoTip label="Element codes">{ELEMENT_TIPS.pattern}</InfoTip>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: c.ink }}>
          <span className="bpm-label-row">Code pattern</span>
          <Input value={pattern} maxLength={ELEMENT_LIMITS.patternMax} spellCheck={false} onChange={(e) => setPattern(e.target.value)} style={{ minHeight: 44 }} data-guide="cp.settings.elements.pattern" aria-invalid={!check.ok} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: c.ink }}>
          <span className="bpm-label-row">Longest code <InfoTip label="Longest code">{ELEMENT_TIPS.codeLimit}</InfoTip></span>
          <Input type="number" inputMode="numeric" min={6} max={ELEMENT_LIMITS.codeMaxHard} value={codeMax} onChange={(e) => setCodeMax(e.target.value)} style={{ minHeight: 44 }} data-guide="cp.settings.elements.code_max" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: c.ink }}>
          <span className="bpm-label-row">Quantity tolerance (%) <InfoTip label="Tolerance">{ELEMENT_TIPS.tolerance}</InfoTip></span>
          <Input type="number" inputMode="decimal" min={0} max={100} step={0.5} value={tolerance} onChange={(e) => setTolerance(e.target.value)} style={{ minHeight: 44 }} data-guide="cp.settings.elements.tolerance" />
        </label>
      </div>
      <div role="status" data-guide="cp.settings.elements.preview" style={{ marginTop: 10, fontSize: 13, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", color: check.ok ? c.ink : "var(--err-ink)" }}>
        {check.ok ? (
          <>
            {previewCodes(check.parts).map((p) => <code key={p} style={{ padding: "2px 8px", borderRadius: 6, background: pillar.teal.bg, color: pillar.teal.fg }}>{p}</code>)}
            <span style={{ color: c.muted }}>Longest {check.max_length} of {Number(codeMax) || ELEMENT_LIMITS.codeMaxDefault} characters</span>
          </>
        ) : <span role="alert">{check.error}</span>}
      </div>

      <div style={{ marginTop: 10 }}>
        <Button variant="quiet" size="sm" aria-expanded={more} style={{ minHeight: 44 }} data-guide="cp.settings.elements.more" onClick={() => setMore((v) => !v)}>{more ? "Hide level names" : "Level names"}</Button>
        <InfoTip label="Level names">{ELEMENT_TIPS.levelNames}</InfoTip>
      </div>
      {more && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 6 }}>
          {(["building", "activity", "cost_element"] as const).map((k) => (
            <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: c.ink }}>
              <span>Level {k === "building" ? 1 : k === "activity" ? 2 : 3}</span>
              <Input value={names[k]} maxLength={30} onChange={(e) => setNames({ ...names, [k]: e.target.value })} style={{ minHeight: 44 }} data-guide={`cp.settings.elements.level_${k}`} />
            </label>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <Button variant="primary" loading={busy} disabled={!dirty || !check.ok} style={{ minHeight: 44 }} data-guide="cp.settings.elements.save" onClick={() => void save()}>Save</Button>
        {msg && <span role={msg.ok ? "status" : "alert"} style={{ fontSize: 13, color: msg.ok ? pillar.teal.fg : "var(--err-ink)" }}>{msg.text}</span>}
      </div>
    </section>
  );
}
