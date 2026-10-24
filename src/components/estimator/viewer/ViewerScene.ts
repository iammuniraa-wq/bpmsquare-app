// The imperative three.js scene behind BuildingViewer. It draws exactly the pieces of a stored
// GeometryModel, physically based: PBR materials from the catalogue (lazy CC0 textures), a generated sky
// for the background and for image-based lighting, a sun with soft shadows, ACES tone mapping, a textured
// ground that fades into fog. It owns everything it creates: dispose() frees geometries, materials,
// textures, the environment map, the renderer, the observers and the animation frame. React only calls
// the setters.
//
// Rendering is on demand (a frame is drawn only when something changed or an animation is running), and
// the shadow map is re-rendered only when the content moved, not while the camera orbits. With reduced
// motion there is no drop animation.
//
// Materials: each part of a piece names a design slot (userData.slot); the slot's material comes from
// `visuals` (a repaint never rebuilds geometry or moves the camera), else the module's default for the
// slot. Pieces are tinted (family or build-step colouring) and emphasised (selected, highlighted) through
// cached material variants that share the base material's textures.

import * as THREE from "three";
import type { GeometryModel, Piece } from "@/lib/estimator/geometry";
import { getGeometry } from "@/lib/estimator/geometry";
import type { DesignSlot } from "@/lib/estimator/geometry/types";
import { CHAINLINK_FENCE_KEY } from "@/lib/estimator/geometry/chainlinkFence";
import { slotValue } from "@/lib/estimator/geometry/pieceSlots";
import { attachOrbit, cameraPosition } from "./orbit";
import type { OrbitState } from "./orbit";
import { createMaterialLibrary } from "./materialLibrary";
import type { MaterialLibrary } from "./materialLibrary";
import { buildPieceGroup, createBuildCtx, disposeBuildCtx, disposeGeometries } from "./pieceMeshes";
import type { BuildCtx } from "./pieceMeshes";
import type { PartDecor } from "./meshKit";
import { metricBoxGeometry, metricGroundGeometry } from "./metricGeometry";
import { createEnvironmentScene, createSkyDome, disposeSky, isDarkTheme, skyPalette, SUN_DIRECTION } from "./skyEnvironment";
import type { SkyPalette } from "./skyEnvironment";

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

/** One paintable mesh of a piece. `own` is a material a builder set itself (equipment): used as the base as it is. */
type Part = { mesh: THREE.Mesh; slot: string | null; def: string | null; noTint: boolean; decor: PartDecor | null; own: THREE.MeshStandardMaterial | null };
type Entry = { piece: Piece; group: THREE.Group; parts: Part[]; tint: number; y0: number };
type Variant = { mat: THREE.MeshStandardMaterial; base: THREE.MeshStandardMaterial; tint: THREE.Color; used: boolean };

export type SceneOptions = { reducedMotion: boolean; onPick: (mark: string | null) => void };

const DROP_MS = 700;
const DROP_HEIGHT_M = 6;
const EXPLODE_M_PER_FLOOR = 5;
const WHITE = new THREE.Color(1, 1, 1);
const BLACK = new THREE.Color(0, 0, 0);
const SUN_FLOOR_M = 40;
const SHADOW_RADIUS_MAX_M = 150;

/** A fence whose whole-run view is farther out than this opens close up at a gate instead. */
const CLOSE_UP_ABOVE_M = 55;
const CLOSE_UP_DIST_M = 34;

export class ViewerScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
  private root = new THREE.Group();
  private ray = new THREE.Raycaster();
  private entries = new Map<string, Entry>();
  private lib: MaterialLibrary;
  private ctx: BuildCtx | null = null;
  private fixed: Part[] = [];
  private variants = new Map<string, Variant>();
  private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private palette: SkyPalette | null = null;
  private fog = new THREE.Fog("#dbe8f3", 50, 400);
  private skyRadius = 400;
  private orbit: OrbitState = { yaw: 0.7, pitch: 0.45, dist: 46, minDist: 8, maxDist: 160 };
  private target: [number, number, number] = [0, 1, 0];
  private colors: SceneColors;
  private mode: ColourMode = "family";
  private stepCount = 1;
  private step = 0;
  private explode = 0;
  private cutaway = false;
  /** A long fence is first shown close up at a gate (the whole run is a thin line from far away); set by setModel. */
  closeUpAvailable = false;
  private closeView: { target: [number, number, number]; dist: number } | null = null;
  private wholeView: { target: [number, number, number]; dist: number } = { target: [0, 1, 0], dist: 30 };
  private cutInfo: { cabin: boolean; d: number } = { cabin: false, d: 0 };
  private selected: string | null = null;
  private highlight: ReadonlySet<string> = new Set();
  private visuals: Readonly<Record<string, string>> = {};
  private slots: readonly DesignSlot[] | undefined;
  private stepColours: THREE.Color[] = [];
  private dropStart = 0;
  private dirty = true;
  private shadowDirty = true;
  private raf = 0;
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  private detach: () => void;
  private reduced: boolean;
  private tmpA = new THREE.Color();
  private tmpB = new THREE.Color();
  private glowTmp = new THREE.Color();

  private constructor(private host: HTMLElement, renderer: THREE.WebGLRenderer, private opts: SceneOptions) {
    this.renderer = renderer;
    this.reduced = opts.reducedMotion;
    this.colors = readSceneColors(host);

    const small = host.clientWidth > 0 && host.clientWidth < 520;
    renderer.setPixelRatio(Math.min(small ? 1.5 : 2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(renderer.domElement);

    this.lib = createMaterialLibrary(Math.min(8, renderer.capabilities.getMaxAnisotropy()), () => this.onTexture());

    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true;
    const size = small ? 1024 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.root);
    this.scene.fog = this.fog;
    this.applyTheme();

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
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      if (!renderer.getContext()) { renderer.dispose(); return null; }
      return new ViewerScene(host, renderer, opts);
    } catch {
      return null;
    }
  }

  /** `keepView`: a recomputed model of the same building, so the camera stays where the person put it. */
  setModel(model: GeometryModel, keepView = false): void {
    this.clearModel();
    this.slots = getGeometry(model.geometry)?.slots;
    this.ctx = createBuildCtx(this.lib, model);

    let maxY = 3;
    let radius = 6;
    model.pieces.forEach((piece) => {
      maxY = Math.max(maxY, piece.pos[1] + piece.dims.h / 2);
      radius = Math.max(radius, Math.hypot(piece.pos[0], piece.pos[2]) + Math.max(piece.dims.w, piece.dims.t) / 2);
    });
    this.cutInfo = { cabin: model.geometry === "porta_cabin", d: model.d };
    this.stepCount = Math.max(1, model.step_names.length);
    this.step = this.stepCount - 1;
    this.target = [0, maxY / 2, 0];
    const dist = Math.max(model.view_min_dist ?? 30, (model.w + model.d) * 1.25 + maxY * 0.5);
    const maxDist = dist * 3.5;
    this.wholeView = { target: [0, maxY / 2, 0], dist };
    this.closeView = null;
    if (model.geometry === CHAINLINK_FENCE_KEY && dist > CLOSE_UP_ABOVE_M) {
      const at = model.pieces.find((p) => p.code === "GT") ?? model.pieces.find((p) => p.code === "CP") ?? model.pieces[0];
      if (at) this.closeView = { target: [at.pos[0], 1.1, at.pos[2]], dist: CLOSE_UP_DIST_M };
    }
    this.closeUpAvailable = this.closeView !== null;
    this.orbit = keepView
      ? { ...this.orbit, maxDist: Math.max(this.orbit.maxDist, maxDist) }
      : { ...this.orbit, dist, minDist: 8, maxDist };
    if (!keepView && this.closeView) { this.target = this.closeView.target; this.orbit.dist = this.closeView.dist; }
    const reach = Math.max(this.orbit.maxDist, maxDist);
    this.fitAtmosphere(dist, reach, radius, maxY);

    const withPlinth = model.geometry !== CHAINLINK_FENCE_KEY;
    const ground = new THREE.Mesh(metricGroundGeometry(this.fogFar * 1.05), this.lib.get("ground_grass"));
    ground.position.y = withPlinth ? -0.41 : 0;
    ground.receiveShadow = true;
    this.fixed = [this.fixedPart(ground, "ground", "ground_grass")];
    this.root.add(ground);
    if (withPlinth) {
      const plinth = new THREE.Mesh(metricBoxGeometry(model.w + 2, 0.4, model.d + 2), this.lib.get("concrete_smooth"));
      plinth.position.y = -0.2;
      plinth.receiveShadow = true;
      this.fixed.push(this.fixedPart(plinth, "plinth", "concrete_smooth"));
      this.root.add(plinth);
    }

    const codes = [...new Set(model.pieces.map((p) => p.code))].sort();
    model.pieces.forEach((piece) => {
      const group = buildPieceGroup(piece, this.ctx!);
      this.root.add(group);
      const parts: Part[] = [];
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const u = mesh.userData as { slot?: string | null; def?: string; noTint?: boolean; decor?: PartDecor | null };
        const own = u.def === undefined && (mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial ? (mesh.material as THREE.MeshStandardMaterial) : null;
        parts.push({ mesh, slot: u.slot ?? null, def: u.def ?? null, noTint: !!u.noTint, decor: u.decor ?? null, own });
      });
      const tint = ((codes.indexOf(piece.code) % 7) - 3) * 0.02;
      this.entries.set(piece.id, { piece, group, parts, tint, y0: piece.pos[1] });
    });
    this.stepColours = Array.from({ length: this.stepCount + 1 }, (_, i) => new THREE.Color().setHSL((i / this.stepCount) * 0.75, 0.42, 0.55));
    this.paint();
    this.applyVisibility();
    this.applyPositions(1);
    this.dirty = true;
    this.shadowDirty = true;
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
  setSelected(mark: string | null): void { this.selected = mark; this.paint(); }
  setHighlight(marks: ReadonlySet<string>): void { this.highlight = marks; this.paint(); }
  setColourMode(m: ColourMode): void { this.mode = m; this.paint(); }

  /** Repaint the model: slot -> material key or "#rrggbb". No geometry is rebuilt and the camera does not move. */
  setVisuals(visuals: Readonly<Record<string, string>> | undefined): void {
    this.visuals = visuals ?? {};
    this.paint();
  }

  /** Re-read the theme variables (light / dark switched). */
  refreshTheme(): void {
    this.applyTheme();
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
    this.lib.dispose();
    if (this.sky) { this.scene.remove(this.sky); disposeSky(this.sky); this.sky = null; }
    this.envRT?.dispose();
    this.envRT = null;
    this.sun.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private fogFar = 400;

  private fixedPart(mesh: THREE.Mesh, slot: string, def: string): Part {
    return { mesh, slot, def, noTint: false, decor: null, own: null };
  }

  /** Camera range, fog, sky size and the sun's shadow box, all from the size of the model and how far the person can zoom. */
  private fitAtmosphere(dist: number, reach: number, radius: number, maxY: number): void {
    this.fogFar = reach * 2.4;
    this.fog.near = dist * 1.4;
    this.fog.far = this.fogFar;
    const far = Math.max(600, this.fogFar * 1.25);
    this.camera.far = far;
    this.camera.near = Math.max(0.1, far / 8000);
    this.camera.updateProjectionMatrix();
    this.skyRadius = far * 0.92;

    const r = Math.min(SHADOW_RADIUS_MAX_M, radius + 8);
    const lightDist = r * 2 + SUN_FLOOR_M + maxY;
    this.sun.target.position.set(0, maxY * 0.35, 0);
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(lightDist).add(this.sun.target.position);
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: lightDist + r * 2 + maxY });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
    this.shadowDirty = true;
  }

  private applyTheme(): void {
    this.colors = readSceneColors(this.host);
    const pal = skyPalette(isDarkTheme(this.colors.ground));
    if (pal !== this.palette) {
      this.palette = pal;
      this.renderer.toneMappingExposure = pal.exposure;
      this.sun.color.set(pal.sun);
      this.sun.intensity = pal.sunLight;
      this.fog.color.set(pal.horizon);
      if (this.sky) { this.scene.remove(this.sky); disposeSky(this.sky); }
      this.sky = createSkyDome(pal);
      this.scene.add(this.sky);
      const pm = new THREE.PMREMGenerator(this.renderer);
      const env = createEnvironmentScene(pal);
      this.envRT?.dispose();
      this.envRT = pm.fromScene(env, 0.02, 1, 100);
      pm.dispose();
      disposeSky(env);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = pal.env;
    }
    this.dirty = true;
  }

  private onTexture(): void {
    if (this.disposed) return;
    for (const v of this.variants.values()) this.syncVariant(v);
    this.dirty = true;
  }

  private clearModel(): void {
    for (const e of this.entries.values()) { this.root.remove(e.group); disposeGeometries(e.group); }
    this.entries.clear();
    for (const f of this.fixed) {
      this.root.remove(f.mesh);
      f.mesh.geometry.dispose();
    }
    this.fixed = [];
    if (this.ctx) { disposeBuildCtx(this.ctx); this.ctx = null; }
    for (const v of this.variants.values()) v.mat.dispose();
    this.variants.clear();
  }

  /** The unemphasised material of a part: its own, else the slot's visual, else the part's default. */
  private baseOf(p: Part): THREE.MeshStandardMaterial {
    if (p.own) return p.own;
    const value = (p.slot ? slotValue(this.slots, this.visuals, p.slot) : null) ?? p.def ?? "concrete_smooth";
    return this.lib.get(value);
  }

  private syncVariant(v: Variant): void {
    const m = v.mat;
    const b = v.base;
    if (m.map !== b.map || m.normalMap !== b.normalMap || m.roughnessMap !== b.roughnessMap) {
      m.map = b.map;
      m.normalMap = b.normalMap;
      m.roughnessMap = b.roughnessMap;
      m.needsUpdate = true;
    }
    m.roughness = b.roughness;
    m.metalness = b.metalness;
    m.color.copy(b.color).multiply(v.tint);
  }

  /** The base material itself when nothing changes it, else a cached copy with the tint, glow and mesh treatment applied. */
  private variantFor(base: THREE.MeshStandardMaterial, tint: THREE.Color, glow: THREE.Color, decor: PartDecor | null): THREE.MeshStandardMaterial {
    const plain = !decor && glow.r === 0 && glow.g === 0 && glow.b === 0 && tint.r === 1 && tint.g === 1 && tint.b === 1;
    if (plain) return base;
    const key = `${base.uuid}|${tint.r.toFixed(3)},${tint.g.toFixed(3)},${tint.b.toFixed(3)}|${glow.r.toFixed(3)},${glow.g.toFixed(3)},${glow.b.toFixed(3)}|${decor?.id ?? ""}`;
    let v = this.variants.get(key);
    if (!v) {
      const mat = base.clone();
      if (decor) {
        mat.alphaMap = decor.alphaMap;
        // The lattice is a fine wire: blended (not cut out) so it still reads as a faint screen when the wires are
        // thinner than a pixel; a low alpha test drops the fully empty texels.
        mat.alphaTest = decor.alphaTest;
        mat.side = THREE.DoubleSide;
        mat.transparent = true;
        mat.depthWrite = false;
      }
      v = { mat, base, tint: tint.clone(), used: true };
      this.variants.set(key, v);
      this.syncVariant(v);
    }
    v.mat.emissive.copy(glow);
    v.used = true;
    return v.mat;
  }

  private paint(): void {
    if (!this.palette) return;
    for (const v of this.variants.values()) v.used = false;
    const accent = color(this.colors.accent, "#378add");
    const tint = this.tmpA;
    const glow = this.tmpB;
    let k = 0;
    for (const e of this.entries.values()) {
      const strength = e.piece.id === this.selected ? 0.6 : this.highlight.has(e.piece.id) ? 0.32 : 0;
      for (const p of e.parts) {
        const base = this.baseOf(p);
        glow.copy(BLACK);
        if (p.noTint) tint.copy(WHITE);
        else if (this.mode === "step") {
          const sc = this.stepColours[Math.min(e.piece.step, this.stepColours.length - 1)] ?? WHITE;
          tint.copy(WHITE).lerp(sc, 0.55);
          glow.copy(sc).multiplyScalar(0.12);
        } else {
          const f = Math.round((1 + e.tint + (((k * 37) % 7) - 3) * 0.006) * 50) / 50;
          tint.setRGB(f, f, f);
        }
        if (strength > 0) glow.add(this.glowTmp.copy(accent).multiplyScalar(strength));
        p.mesh.material = this.variantFor(base, tint, glow, p.decor);
      }
      k++;
    }
    const groundTint = color(this.palette.groundTint, "#ffffff");
    for (const f of this.fixed) f.mesh.material = this.variantFor(this.baseOf(f), f.slot === "ground" ? groundTint : WHITE, BLACK, null);
    for (const [key, v] of this.variants) {
      if (v.used) continue;
      v.mat.dispose();
      this.variants.delete(key);
    }
    this.dirty = true;
  }

  /** A long fence: look at one gate from close by, or at the whole run. */
  setFraming(closeUp: boolean): void {
    const v = closeUp && this.closeView ? this.closeView : this.wholeView;
    this.target = [...v.target] as [number, number, number];
    this.orbit = { ...this.orbit, dist: v.dist };
    this.dirty = true;
  }

  /** See inside a cabin: the roof and the front long wall are hidden (the rooms and their equipment show). */
  setCutaway(on: boolean): void { this.cutaway = on; this.applyVisibility(); this.dirty = true; }

  private cutAway(p: Piece): boolean {
    if (!this.cutaway || !this.cutInfo.cabin) return false;
    return p.code === "RF" || (p.code === "WL" && Math.abs(Math.sin(p.rot ?? 0)) < 0.5 && p.pos[2] > this.cutInfo.d / 2 - 0.3);
  }

  private applyVisibility(): void {
    for (const e of this.entries.values()) e.group.visible = e.piece.step <= this.step && !this.cutAway(e.piece);
    this.shadowDirty = true;
  }

  private applyPositions(dropK: number): void {
    const drop = (1 - dropK) * (1 - dropK) * DROP_HEIGHT_M;
    for (const e of this.entries.values()) {
      const falling = e.piece.step === this.step ? drop : 0;
      e.group.position.y = e.y0 + falling + this.explode * e.piece.floor * EXPLODE_M_PER_FLOOR;
    }
    this.shadowDirty = true;
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
    if (this.sky) { this.sky.position.copy(this.camera.position); this.sky.scale.setScalar(this.skyRadius); }
    if (this.shadowDirty) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    this.renderer.render(this.scene, this.camera);
  };
}
