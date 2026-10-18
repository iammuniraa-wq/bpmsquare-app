// Camera orbit maths and pointer / touch / keyboard controls for the building
// viewer. No three.js here: the maths is plain numbers (and unit-tested), and
// PointerOrbit only turns DOM events into changes of an OrbitState.

export type OrbitState = {
  /** Radians around the vertical axis. */
  yaw: number;
  /** Radians above the horizon, kept inside (PITCH_MIN, PITCH_MAX). */
  pitch: number;
  dist: number;
  minDist: number;
  maxDist: number;
};

export const PITCH_MIN = 0.08;
export const PITCH_MAX = 1.45;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function applyDrag(s: OrbitState, dx: number, dy: number): OrbitState {
  return { ...s, yaw: s.yaw - dx * 0.008, pitch: clamp(s.pitch + dy * 0.006, PITCH_MIN, PITCH_MAX) };
}

/** factor > 1 moves the camera away. */
export function applyZoom(s: OrbitState, factor: number): OrbitState {
  if (!Number.isFinite(factor) || factor <= 0) return s;
  return { ...s, dist: clamp(s.dist * factor, s.minDist, s.maxDist) };
}

export function cameraPosition(target: readonly [number, number, number], s: OrbitState): [number, number, number] {
  return [
    target[0] + s.dist * Math.cos(s.pitch) * Math.sin(s.yaw),
    target[1] + s.dist * Math.sin(s.pitch),
    target[2] + s.dist * Math.cos(s.pitch) * Math.cos(s.yaw),
  ];
}

export type OrbitHandlers = {
  get: () => OrbitState;
  set: (s: OrbitState) => void;
  /** A press that did not drag: client coordinates. */
  onTap: (clientX: number, clientY: number) => void;
  onEscape?: () => void;
};

/** Mouse drag / wheel, one-finger rotate, two-finger pinch, arrow keys and + / -. Returns its own cleanup. */
export function attachOrbit(el: HTMLElement, h: OrbitHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let downAt = 0;
  let pinchBase = 0;

  const pinchDistance = (): number => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const down = (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { moved = 0; downAt = e.timeStamp; }
    if (pointers.size === 2) pinchBase = pinchDistance();
    try { el.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
  };
  const move = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      h.set(applyDrag(h.get(), dx, dy));
    } else if (pointers.size === 2) {
      moved += 99;
      const now = pinchDistance();
      if (pinchBase > 0 && now > 0) h.set(applyZoom(h.get(), pinchBase / now));
      pinchBase = now;
    }
  };
  const up = (e: PointerEvent) => {
    const wasOnly = pointers.size === 1 && pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size === 1) { moved += 99; }
    if (wasOnly && moved < 6 && e.timeStamp - downAt < 700 && e.type === "pointerup") h.onTap(e.clientX, e.clientY);
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    h.set(applyZoom(h.get(), 1 + e.deltaY * 0.001));
  };
  const key = (e: KeyboardEvent) => {
    const s = h.get();
    switch (e.key) {
      case "ArrowLeft": h.set(applyDrag(s, -12, 0)); break;
      case "ArrowRight": h.set(applyDrag(s, 12, 0)); break;
      case "ArrowUp": h.set(applyDrag(s, 0, 12)); break;
      case "ArrowDown": h.set(applyDrag(s, 0, -12)); break;
      case "+": case "=": h.set(applyZoom(s, 0.9)); break;
      case "-": case "_": h.set(applyZoom(s, 1.1)); break;
      case "Escape": h.onEscape?.(); return;
      default: return;
    }
    e.preventDefault();
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", wheel, { passive: false });
  el.addEventListener("keydown", key);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("wheel", wheel);
    el.removeEventListener("keydown", key);
  };
}
