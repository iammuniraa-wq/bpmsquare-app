// The imperative three.js scene behind BuildingViewer. It draws exactly the
// pieces of a stored GeometryModel and owns everything it creates: dispose()
// frees geometries, materials, the renderer, the observers and the animation
// frame. React only calls the setters.
//
// Rendering is on demand (a frame is drawn only when something changed or an
// animation is running). With reduced motion there is no drop animation.

import * as THREE from "three";
import type { GeometryModel, Piece } from "@/lib/estimator/geometry";
import { attachOrbit, cameraPosition } from "./orbit";
import type { OrbitState } from "./orbit";
import { buildPieceGroup, disposeGeometries } from "./pieceMeshes";
import type { SharedMaterials } from "./pieceMeshes";

export type SceneColors = { concrete: string; line: string; glass: string; ground: string; accent: string };
export type ColourMode = "family" | "step";

/** Theme colours from the CSS variables in effect at `el` (light or dark). */
export function readSceneColors(el: HTMLElement): SceneColors {
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    concrete: get("--est-concrete", "#c9d1d9"),
    line: get("--est-concrete-line", "#8d99a6"),
    glass: get("--est-glass", "#b9dbe6"),
    ground: get("--est-ground", "#d6cdbf"),
    accent: get("--accent", "#378add"),
  };
}

function color(value: string, fallback: string): THREE.Color {
  const c = new THREE.Color();
  try { c.set(value); } catch { c.set(fallback); }
  return c;
}

type Entry = { piece: Piece; group: THREE.Group; mat: THREE.MeshLambertMaterial; tint: number; y0: number };

export type SceneOptions = { reducedMotion: boolean; onPick: (mark: string | null) => void };

const DROP_MS = 700;
const DROP_HEIGHT_M = 6;
const EXPLODE_M_PER_FLOOR = 5;

export class ViewerScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
  private root = new THREE.Group();
  private ray = new THREE.Raycaster();
  private entries = new Map<string, Entry>();
  private fixed: THREE.Mesh[] = [];
  private shared: SharedMaterials;
  private ownMaterials: THREE.Material[] = [];
  private lights: THREE.Light[] = [];
  private orbit: OrbitState = { yaw: 0.7, pitch: 0.45, dist: 46, minDist: 8, maxDist: 160 };
  private target: [number, number, number] = [0, 1, 0];
  private colors: SceneColors;
  private mode: ColourMode = "family";
  private stepCount = 1;
  private step = 0;
  private explode = 0;
  private selected: string | null = null;
  private highlight: ReadonlySet<string> = new Set();
  private dropStart = 0;
  private dirty = true;
  private raf = 0;
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  private detach: () => void;
  private reduced: boolean;

  private constructor(private host: HTMLElement, renderer: THREE.WebGLRenderer, private opts: SceneOptions) {
    this.renderer = renderer;
    this.reduced = opts.reducedMotion;
    this.colors = readSceneColors(host);
    const edge = new THREE.LineBasicMaterial({ color: color(this.colors.line, "#8d99a6") });
    const glass = new THREE.MeshLambertMaterial({ color: color(this.colors.glass, "#b9dbe6"), transparent: true, opacity: 0.65 });
    const door = new THREE.MeshLambertMaterial({ color: 0x7a5c3e });
    this.shared = { edge, glass, door };
    this.ownMaterials.push(edge, glass, door);

    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xdfeaf5, 0x8a8372, 0.85);
    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.position.set(34, 55, 26);
    sun.castShadow = true;
    const small = host.clientWidth > 0 && host.clientWidth < 520;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, far: 200 });
    sun.shadow.radius = 3;
    this.lights.push(hemi, sun);
    this.scene.add(hemi, sun, this.root);

    this.detach = attachOrbit(host, {
      get: () => this.orbit,
      set: (s) => { this.orbit = s; this.dirty = true; },
      onTap: (x, y) => this.pickAt(x, y),
      onEscape: () => this.opts.onPick(null),
    });
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(host);
    }
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** null when WebGL is not available (the caller shows a message instead). */
  static create(host: HTMLElement, opts: SceneOptions): ViewerScene | null {
    try {
      if (typeof WebGLRenderingContext === "undefined") return null;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      if (!renderer.getContext()) { renderer.dispose(); return null; }
      return new ViewerScene(host, renderer, opts);
    } catch {
      return null;
    }
  }

  /** `keepView`: a recomputed model of the same building, so the camera stays where the person put it. */
  setModel(model: GeometryModel, keepView = false): void {
    this.clearModel();
    const c = this.colors;
    const ground = new THREE.MeshLambertMaterial({ color: color(c.ground, "#d6cdbf") });
    const slab = new THREE.MeshLambertMaterial({ color: color(c.ground, "#d6cdbf").offsetHSL(0, 0, -0.08) });
    this.ownMaterials.push(ground, slab);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), ground);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.41;
    plane.receiveShadow = true;
    const found = new THREE.Mesh(new THREE.BoxGeometry(model.w + 2, 0.4, model.d + 2), slab);
    found.position.y = -0.2;
    found.receiveShadow = true;
    this.fixed = [plane, found];
    this.root.add(plane, found);

    const codes = [...new Set(model.pieces.map((p) => p.code))].sort();
    let maxY = 3;
    model.pieces.forEach((piece) => {
      const mat = new THREE.MeshLambertMaterial();
      this.ownMaterials.push(mat);
      const group = buildPieceGroup(piece, mat, this.shared);
      this.root.add(group);
      const tint = ((codes.indexOf(piece.code) % 7) - 3) * 0.02;
      this.entries.set(piece.id, { piece, group, mat, tint, y0: piece.pos[1] });
      maxY = Math.max(maxY, piece.pos[1] + piece.dims.h / 2);
    });
    this.stepCount = Math.max(1, model.step_names.length);
    this.step = this.stepCount - 1;
    this.target = [0, maxY / 2, 0];
    const dist = Math.max(30, (model.w + model.d) * 1.25 + maxY * 0.5);
    this.orbit = keepView
      ? { ...this.orbit, maxDist: Math.max(this.orbit.maxDist, dist * 3.5) }
      : { ...this.orbit, dist, minDist: 8, maxDist: dist * 3.5 };
    this.paint();
    this.applyVisibility();
    this.applyPositions(1);
    this.dirty = true;
  }

  setStep(step: number, animate: boolean): void {
    this.step = Math.max(0, Math.min(this.stepCount - 1, Math.floor(step)));
    this.applyVisibility();
    this.dropStart = animate && !this.reduced ? performance.now() : 0;
    this.applyPositions(this.dropStart ? 0 : 1);
    this.dirty = true;
  }

  setExplode(v: number): void { this.explode = Math.max(0, Math.min(1, v)); this.applyPositions(this.dropStart ? 0 : 1); this.dirty = true; }
  setReducedMotion(r: boolean): void { this.reduced = r; if (r) { this.dropStart = 0; this.applyPositions(1); this.dirty = true; } }
  setSelected(mark: string | null): void { this.selected = mark; this.paintEmphasis(); }
  setHighlight(marks: ReadonlySet<string>): void { this.highlight = marks; this.paintEmphasis(); }
  setColourMode(m: ColourMode): void { this.mode = m; this.paint(); }

  /** Re-read the theme variables (light / dark switched). */
  refreshTheme(): void {
    this.colors = readSceneColors(this.host);
    const c = this.colors;
    this.shared.edge.color = color(c.line, "#8d99a6");
    this.shared.glass.color = color(c.glass, "#b9dbe6");
    const [plane, found] = this.fixed;
    if (plane) (plane.material as THREE.MeshLambertMaterial).color = color(c.ground, "#d6cdbf");
    if (found) (found.material as THREE.MeshLambertMaterial).color = color(c.ground, "#d6cdbf").offsetHSL(0, 0, -0.08);
    this.paint();
  }

  resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detach();
    this.resizeObs?.disconnect();
    this.clearModel();
    this.ownMaterials.forEach((m) => m.dispose());
    this.ownMaterials = [];
    this.lights.forEach((l) => { l.dispose?.(); });
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private clearModel(): void {
    for (const e of this.entries.values()) {
      this.root.remove(e.group);
      disposeGeometries(e.group);
      e.mat.dispose();
      this.ownMaterials = this.ownMaterials.filter((m) => m !== e.mat);
    }
    this.entries.clear();
    for (const f of this.fixed) {
      this.root.remove(f);
      f.geometry.dispose();
      const m = f.material as THREE.Material;
      m.dispose();
      this.ownMaterials = this.ownMaterials.filter((x) => x !== m);
    }
    this.fixed = [];
  }

  private paint(): void {
    const base = color(this.colors.concrete, "#c9d1d9");
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    let k = 0;
    for (const e of this.entries.values()) {
      const c = base.clone();
      if (this.mode === "step") {
        c.setHSL((e.piece.step / this.stepCount) * 0.75, 0.42, Math.min(0.72, Math.max(0.42, hsl.l)));
      } else {
        c.offsetHSL(0, 0, e.tint + (((k * 37) % 7) - 3) * 0.006);
      }
      e.mat.color.copy(c);
      k++;
    }
    this.paintEmphasis();
  }

  private paintEmphasis(): void {
    const accent = color(this.colors.accent, "#378add");
    for (const e of this.entries.values()) {
      const id = e.piece.id;
      const strength = id === this.selected ? 0.6 : this.highlight.has(id) ? 0.32 : 0;
      e.mat.emissive.copy(accent).multiplyScalar(strength);
    }
    this.dirty = true;
  }

  private applyVisibility(): void {
    for (const e of this.entries.values()) e.group.visible = e.piece.step <= this.step;
  }

  private applyPositions(dropK: number): void {
    const drop = (1 - dropK) * (1 - dropK) * DROP_HEIGHT_M;
    for (const e of this.entries.values()) {
      const falling = e.piece.step === this.step ? drop : 0;
      e.group.position.y = e.y0 + falling + this.explode * e.piece.floor * EXPLODE_M_PER_FLOOR;
    }
  }

  private pickAt(clientX: number, clientY: number): void {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const groups = [...this.entries.values()].filter((e) => e.group.visible).map((e) => e.group);
    const hit = this.ray.intersectObjects(groups, true).find((h) => typeof h.object.userData.mark === "string");
    this.opts.onPick(hit ? (hit.object.userData.mark as string) : null);
  }

  private frame = (t: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.dropStart) {
      const k = Math.min(1, (t - this.dropStart) / DROP_MS);
      this.applyPositions(k);
      if (k >= 1) this.dropStart = 0;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const p = cameraPosition(this.target, this.orbit);
    this.camera.position.set(p[0], p[1], p[2]);
    this.camera.lookAt(this.target[0], this.target[1], this.target[2]);
    this.renderer.render(this.scene, this.camera);
  };
}
