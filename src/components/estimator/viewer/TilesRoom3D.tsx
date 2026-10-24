"use client";

import { useEffect, useRef } from "react";
import Button from "@/components/ui/Button";
import type { TileLayout } from "@/lib/estimator/geometry/tilesFloor";
import { TilesRoomScene } from "./tilesRoomScene";

/**
 * The laid floor as a lit room in 3D: the tiles of `layout` (cut ones cut), the grout, skirting and two or
 * three walls with a window. `visuals` (design slot -> material key or "#rrggbb") repaints the room without
 * laying it again; `reveal` below 1 shows only that share of the tiles (the laying animation).
 * `onUnavailable` is called once if this device gives no WebGL, so the caller can show the 2D plan instead.
 */
export default function TilesRoom3D({
  layout, visuals, reveal, reducedMotion, label, onUnavailable,
}: {
  layout: TileLayout;
  visuals?: Readonly<Record<string, string>>;
  reveal: number;
  reducedMotion: boolean;
  label: string;
  onUnavailable: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<TilesRoomScene | null>(null);
  const first = useRef(true);
  const visualsRef = useRef(visuals);
  visualsRef.current = visuals;
  const lastVisuals = useRef<string>("");
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = TilesRoomScene.create(host, { reducedMotion });
    if (!scene) { unavailable.current(); return; }
    sceneRef.current = scene;
    first.current = true;

    const root = host.closest("[data-theme]") ?? document.documentElement;
    const obs = new MutationObserver(() => scene.refreshTheme());
    obs.observe(root, { attributes: true, attributeFilter: ["data-mode", "data-theme", "class", "style"] });
    return () => {
      obs.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
    // The scene lives as long as this component; reducedMotion only matters at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setLayout(layout, visualsRef.current, !first.current);
    first.current = false;
    lastVisuals.current = JSON.stringify(visualsRef.current ?? {});
  }, [layout]);

  const visualsKey = JSON.stringify(visuals ?? {});
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || visualsKey === lastVisuals.current) return;
    lastVisuals.current = visualsKey;
    scene.setVisuals(visualsRef.current);
  }, [visualsKey]);

  useEffect(() => {
    sceneRef.current?.setReveal(reveal < 1 ? reveal : null);
  }, [reveal]);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={hostRef}
        role="img"
        aria-label={label}
        tabIndex={0}
        style={{
          height: "clamp(300px, 56vw, 520px)", width: "100%", touchAction: "none", cursor: "grab", borderRadius: 10,
          border: "1px solid var(--line)", background: "var(--panel2)", overflow: "hidden", outlineOffset: 2,
        }}
      />
      <div style={{ position: "absolute", right: 8, bottom: 8 }}>
        <Button size="sm" variant="secondary" style={{ minHeight: 44 }} onClick={() => sceneRef.current?.resetView()}>Reset view</Button>
      </div>
    </div>
  );
}
