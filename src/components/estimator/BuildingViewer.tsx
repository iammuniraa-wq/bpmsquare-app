"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { getGeometry } from "@/lib/estimator/geometry";
import type { AllocLine } from "@/lib/estimator/pieceInfo";
import EmptyState from "@/components/ui/EmptyState";
import { ViewerScene } from "./viewer/ViewerScene";
import type { ColourMode } from "./viewer/ViewerScene";
import ViewerControls from "./viewer/ViewerControls";
import PieceInspector from "./viewer/PieceInspector";

const PLAY_INTERVAL_MS = 1200;

/** Reads the system "reduce motion" setting and follows changes. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/**
 * The estimate's pieces in 3D, exactly as stored on the estimate (the same
 * pieces the BOM was summed from). The generated model stands in for the
 * client's own BIM model. `highlightMarks` lights up the pieces of a BOM line.
 */
export default function BuildingViewer({
  model, lines, densityTm3, money, highlightMarks,
}: {
  model: GeometryModel | null;
  lines: readonly AllocLine[];
  densityTm3: number;
  money: (n: number) => string;
  highlightMarks?: readonly string[];
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ViewerScene | null>(null);
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const [webgl, setWebgl] = useState(true);
  const steps = model ? Math.max(1, model.step_names.length) : 1;
  const [step, setStepState] = useState(steps - 1);
  const [explode, setExplode] = useState(0);
  const [mode, setMode] = useState<ColourMode>("family");
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const highlight = useMemo(() => new Set(highlightMarks ?? []), [highlightMarks]);

  useEffect(() => {
    const host = hostRef.current;
    if (!model || !host) return;
    const scene = ViewerScene.create(host, { reducedMotion: reducedRef.current, onPick: setSelected });
    if (!scene) { setWebgl(false); return; }
    setWebgl(true);
    sceneRef.current = scene;
    scene.setModel(model);
    setStepState(Math.max(1, model.step_names.length) - 1);
    setSelected(null);

    const root = host.closest("[data-theme]") ?? document.documentElement;
    const obs = new MutationObserver(() => scene.refreshTheme());
    obs.observe(root, { attributes: true, attributeFilter: ["data-mode", "data-theme", "class", "style"] });
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const onScheme = () => scene.refreshTheme();
    mq?.addEventListener("change", onScheme);
    return () => {
      obs.disconnect();
      mq?.removeEventListener("change", onScheme);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [model]);

  useEffect(() => { sceneRef.current?.setExplode(explode); }, [explode, model]);
  useEffect(() => { sceneRef.current?.setColourMode(mode); }, [mode, model]);
  useEffect(() => { sceneRef.current?.setSelected(selected); }, [selected, model]);
  useEffect(() => { sceneRef.current?.setHighlight(highlight); }, [highlight, model]);
  useEffect(() => { sceneRef.current?.setReducedMotion(reduced); if (reduced) setPlaying(false); }, [reduced]);

  const goStep = useCallback((n: number, animate = true) => {
    const next = Math.max(0, Math.min(steps - 1, n));
    setStepState(next);
    sceneRef.current?.setStep(next, animate);
  }, [steps]);

  useEffect(() => {
    if (!playing || reduced) return;
    if (step >= steps - 1) { setPlaying(false); return; }
    const t = setTimeout(() => goStep(step + 1), PLAY_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [playing, reduced, step, steps, goStep]);

  const onPlay = () => {
    if (playing) { setPlaying(false); return; }
    if (step >= steps - 1) goStep(0, false);
    setPlaying(true);
  };

  const submitMark = () => {
    const m = typed.trim().toUpperCase();
    if (model?.pieces.some((p) => p.id === m)) setSelected(m);
  };

  if (!model || model.pieces.length === 0) {
    return <EmptyState title="Calculate the estimate to see the model" text="The 3D model is built from the estimate's pieces. Open the Inputs tab and calculate." />;
  }
  const families = (getGeometry(model.geometry)?.piece_codes ?? [])
    .map((p) => ({ label: p.label, n: model.pieces.filter((x) => x.code === p.code).length }))
    .filter((f) => f.n > 0);

  return (
    <div>
      <div className="bpm-t-help" style={{ marginBottom: 8 }}>
        <b style={{ color: "var(--ink)" }}>{model.pieces.length} pieces</b>, each one a bill-of-materials item
        {families.length > 0 ? `: ${families.map((f) => `${f.n} × ${f.label.toLowerCase()}`).join(", ")}` : ""}.
        The model is generated from the inputs and stands in for the client&apos;s own BIM model.
      </div>
      {!webgl ? (
        <div role="alert" style={{ padding: 16, border: "1px dashed var(--line)", borderRadius: 10, color: "var(--muted)", fontSize: 13 }}>
          The 3D view needs WebGL, which this browser or device is not providing. The schedule, risk and cost sections below still work.
        </div>
      ) : (
        <div
          ref={hostRef}
          tabIndex={0}
          role="group"
          aria-label={`3D model of the building, ${model.pieces.length} pieces. Drag or use the arrow keys to rotate, scroll or plus and minus to zoom, click a piece to inspect it.`}
          style={{ height: "clamp(300px, 52vw, 520px)", width: "100%", touchAction: "none", cursor: "grab", borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel2)", overflow: "hidden", outlineOffset: 2 }}
        />
      )}
      {webgl && (
        <ViewerControls
          step={step} steps={steps} stepName={model.step_names[step] ?? ""} playing={playing} reducedMotion={reduced}
          explode={explode} mode={mode} onStep={(n) => { setPlaying(false); goStep(n); }} onPlay={onPlay}
          onExplode={setExplode} onMode={setMode}
        />
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end", margin: "12px 0 4px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          Find a piece by mark
          <input className="bpm-input" list="est-marks" value={typed} placeholder="e.g. EW-07" style={{ width: 150 }}
            onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitMark(); }} onBlur={submitMark} />
        </label>
        <datalist id="est-marks">{model.pieces.slice(0, 600).map((p) => <option key={p.id} value={p.id} />)}</datalist>
      </div>
      <PieceInspector model={model} mark={selected} lines={lines} densityTm3={densityTm3} money={money} onClear={() => setSelected(null)} />
    </div>
  );
}
