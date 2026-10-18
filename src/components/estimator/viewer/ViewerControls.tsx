"use client";

import Button from "@/components/ui/Button";
import type { ColourMode } from "./ViewerScene";

const lbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)", minWidth: 0, flex: "1 1 180px" };

/** Erection play / step controls, explode slider and colour mode. Every control has a text label. */
export default function ViewerControls({
  step, steps, stepName, playing, reducedMotion, explode, mode,
  onStep, onPlay, onExplode, onMode,
}: {
  step: number;
  steps: number;
  stepName: string;
  playing: boolean;
  reducedMotion: boolean;
  explode: number;
  mode: ColourMode;
  onStep: (n: number) => void;
  onPlay: () => void;
  onExplode: (v: number) => void;
  onMode: (m: ColourMode) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {!reducedMotion && (
          <Button size="sm" variant="secondary" onClick={onPlay} aria-pressed={playing}>{playing ? "Pause" : "Watch it being built"}</Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => onStep(step - 1)} disabled={step <= 0}>Previous step</Button>
        <Button size="sm" variant="secondary" onClick={() => onStep(step + 1)} disabled={step >= steps - 1}>Next step</Button>
        <span role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--ink)", flex: "1 1 200px" }}>
          Step {step + 1} of {steps}: {stepName}
        </span>
      </div>
      {reducedMotion && (
        <div className="bpm-t-help">Automatic playback and the drop animation are off because your device asks for reduced motion. Use the step buttons or the slider.</div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        <label style={lbl}>
          Build step
          <input type="range" min={0} max={Math.max(0, steps - 1)} step={1} value={step} onChange={(e) => onStep(Number(e.target.value))}
            aria-valuetext={`Step ${step + 1} of ${steps}: ${stepName}`} />
        </label>
        <label style={lbl}>
          Pull the floors apart
          <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => onExplode(Number(e.target.value))}
            aria-valuetext={`${Math.round(explode * 100)} percent`} />
        </label>
        <label style={{ ...lbl, flex: "0 1 170px" }}>
          Colour by
          <select className="bpm-input" value={mode} onChange={(e) => onMode(e.target.value as ColourMode)}>
            <option value="family">Piece type</option>
            <option value="step">Build step</option>
          </select>
        </label>
      </div>
    </div>
  );
}
