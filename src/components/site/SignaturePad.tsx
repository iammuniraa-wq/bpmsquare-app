"use client";

import { useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";

/** A finger signature on a canvas, optional. Calls `onChange` with a PNG blob once drawn and with null when cleared. Pointer events, so touch, pen and mouse work. */
export default function SignaturePad({ onChange }: { onChange: (blob: Blob | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [has, setHas] = useState(false);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    cv.width = cv.clientWidth * ratio;
    cv.height = cv.clientHeight * ratio;
    const ctx = cv.getContext("2d");
    if (ctx) { ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "black"; }
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = e.currentTarget.getContext("2d"); const p = pos(e);
    ctx?.beginPath(); ctx?.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d"); const p = pos(e);
    ctx?.lineTo(p.x, p.y); ctx?.stroke();
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    setHas(true);
    e.currentTarget.toBlob((b) => onChange(b), "image/png");
  };
  const clear = () => {
    const cv = ref.current; const ctx = cv?.getContext("2d");
    if (cv && ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore(); }
    setHas(false); onChange(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <canvas
        ref={ref} aria-label="Signature, draw with your finger" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ width: "100%", height: 140, touchAction: "none", background: "white", border: `1px dashed ${c.line}`, borderRadius: 10 }}
      />
      {has && <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" style={{ alignSelf: "flex-start" }} onClick={clear}>Clear signature</button>}
    </div>
  );
}
