// The imperative three.js scene behind TilesRoom3D: a cut-away room whose floor is the real laid tiles.
// It draws what layTiles() produced (one merged mesh, cut tiles as cut shapes), a grout bed under it, the
// skirting, two or three walls with a window the light comes through, image-based lighting (RoomEnvironment),
// one soft-shadow sun and ACES tone mapping. Rendering is on demand; dispose() frees everything it created.

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { TileLayout } from "@/lib/estimator/geometry/tilesFloor";
import { attachOrbit, cameraPosition } from "./orbit";
import type { OrbitState } from "./orbit";
import { createMaterialLibrary } from "./materialLibrary";
import type { MaterialLibrary } from "./materialLibrary";
import {
  buildTileMesh, GROUT_TOP_M, revealCount, roomOutline, skirtingBoards, slotValues, SLAB_DEPTH_M, SKIRTING_THICK_M,
  toWorld, uvModeFor, viewDistances, wallPlacements, WALL_HEIGHT_M, WALL_THICK_M,
} from "./tilesMeshData";
import type { TileMeshData, UvMode } from "./tilesMeshData";

export type TilesSceneOptions = { reducedMotion: boolean };

type Wall = { mesh: THREE.Mesh; sky: THREE.Mesh | null; mat: THREE.MeshStandardMaterial; origin: THREE.Vector3; outward: THREE.Vector3 };

const SETTLE_MS = 3500;

export class TilesRoomScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  private room = new THREE.Group();
  private lib: MaterialLibrary;
  private geometries: THREE.BufferGeometry[] = [];
  private ownMaterials: THREE.Material[] = [];
  private envTexture: THREE.Texture | null = null;
  private sun = new THREE.DirectionalLight(0xfff0dc, 3.4);
  private groutMat = new THREE.MeshStandardMaterial({ color: "#9a9a96", roughness: 0.95, metalness: 0 });
  private skirtMat = new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.55, metalness: 0 });
  private wallBase = new THREE.MeshStandardMaterial({ color: "#d9d5cc", roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  private slabMat = new THREE.MeshStandardMaterial({ color: "#a8a6a0", roughness: 0.95, metalness: 0 });
  private skyMat = new THREE.MeshBasicMaterial({ color: "#f3e6cf", toneMapped: false });
  private tileMesh: THREE.Mesh | null = null;
  private tileData: TileMeshData | null = null;
  private tileGeo: THREE.BufferGeometry | null = null;
  private layout: TileLayout | null = null;
  private mode: UvMode = "tile";
  private walls: Wall[] = [];
  private reveal: number | null = null;
  private orbit: OrbitState = { yaw: 0.5, pitch: 0.62, dist: 8, minDist: 1, maxDist: 40 };
  private startOrbit: OrbitState = this.orbit;
  private target = new THREE.Vector3(0, 0.1, 0);
  private dirty = true;
  private keepUntil = 0;
  private raf = 0;
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  private detach: () => void;
  private onLost = (e: Event) => { e.preventDefault(); };
  private onRestored = () => { this.dirty = true; this.schedule(); };

  private constructor(private host: HTMLElement, renderer: THREE.WebGLRenderer, opts: TilesSceneOptions) {
    this.renderer = renderer;
    void opts;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.72;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    renderer.domElement.addEventListener("webglcontextlost", this.onLost);
    renderer.domElement.addEventListener("webglcontextrestored", this.onRestored);
    host.appendChild(renderer.domElement);

    this.lib = createMaterialLibrary(renderer.capabilities.getMaxAnisotropy());

    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    env.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.6;

    const fill = new THREE.HemisphereLight(0xeaf1ff, 0x9b9486, 0.35);
    this.sun.castShadow = true;
    const small = host.clientWidth > 0 && host.clientWidth < 520;
    this.sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.scene.add(fill, this.sun, this.sun.target, this.room);
    this.ownMaterials.push(this.groutMat, this.skirtMat, this.wallBase, this.slabMat, this.skyMat);

    this.detach = attachOrbit(host, {
      get: () => this.orbit,
      set: (s) => { this.orbit = s; this.request(); },
      onTap: () => { /* the room has nothing to pick */ },
      onEscape: () => this.resetView(),
    });
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(host);
    }
    this.resize();
  }

  /** null when WebGL is not available (the caller falls back to the 2D plan). */
  static create(host: HTMLElement, opts: TilesSceneOptions): TilesRoomScene | null {
    try {
      if (typeof WebGLRenderingContext === "undefined") return null;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      if (!renderer.getContext()) { renderer.dispose(); return null; }
      return new TilesRoomScene(host, renderer, opts);
    } catch {
      return null;
    }
  }

  // ── content ──

  /** Lay a floor into the room. `keepView`: the same room edited, so the camera stays where the person put it. */
  setLayout(layout: TileLayout, visuals: Readonly<Record<string, string>> | undefined, keepView: boolean): void {
    this.clearRoom();
    this.layout = layout;
    const slots = slotValues(visuals);
    this.mode = uvModeFor(slots.tile);
    const size = layout.inputs;
    const outline = roomOutline(layout);

    const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p[0] - size.length / 2, p[1] - size.width / 2)));
    // Grout: the room outline just under the tile tops. Slab: the same shape, the depth of a screed.
    const groutGeo = new THREE.ShapeGeometry(shape);
    groutGeo.rotateX(-Math.PI / 2);
    const grout = new THREE.Mesh(groutGeo, this.groutMat);
    grout.position.y = GROUT_TOP_M;
    grout.receiveShadow = true;
    const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: SLAB_DEPTH_M, bevelEnabled: false });
    slabGeo.rotateX(-Math.PI / 2);
    const slab = new THREE.Mesh(slabGeo, this.slabMat);
    slab.position.y = -SLAB_DEPTH_M;
    slab.receiveShadow = true;
    this.geometries.push(groutGeo, slabGeo);
    this.room.add(grout, slab);

    this.buildTiles();
    this.buildSkirting(layout);
    this.buildWalls(layout);
    this.paint(slots);

    const d = viewDistances(layout);
    const fit = { minDist: d.min, maxDist: d.max };
    this.startOrbit = { yaw: 0.5, pitch: 0.62, dist: d.start, ...fit };
    this.orbit = keepView ? { ...this.orbit, ...fit, dist: Math.min(d.max, Math.max(d.min, this.orbit.dist)) } : { ...this.startOrbit };
    this.target.set(0, 0.1, 0);

    const half = d.size / 2 + 2.5;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far: half * 6 });
    this.sun.shadow.camera.updateProjectionMatrix();
    const dir = new THREE.Vector3(-0.25, 0.8, -0.55).normalize().multiplyScalar(half * 2.4);
    this.sun.position.copy(this.target).add(dir);
    this.sun.target.position.copy(this.target);
    this.sun.target.updateMatrixWorld();

    this.kick();
  }

  /** Repaint the three design slots without rebuilding the room (the tile geometry only when the texture mapping changes). */
  setVisuals(visuals: Readonly<Record<string, string>> | undefined): void {
    if (!this.layout) return;
    const slots = slotValues(visuals);
    const mode = uvModeFor(slots.tile);
    if (mode !== this.mode) {
      this.mode = mode;
      this.buildTiles();
    }
    this.paint(slots);
    this.kick();
  }

  /** 0..1 shows that share of the tiles (the laying animation); null shows them all. */
  setReveal(fraction: number | null): void {
    this.reveal = fraction;
    this.applyReveal();
    this.request();
  }

  resetView(): void {
    this.orbit = { ...this.startOrbit };
    this.request();
  }

  refreshTheme(): void {
    this.request();
  }

  private paint(slots: ReturnType<typeof slotValues>): void {
    if (this.tileMesh) {
      const mat = this.lib.get(slots.tile, this.mode === "tile" ? 1 : undefined);
      if (!mat.vertexColors) { mat.vertexColors = true; mat.needsUpdate = true; }
      mat.normalScale.set(0.7, 0.7);
      this.tileMesh.material = mat;
    }
    this.groutMat.color.set(slots.grout);
    this.skirtMat.color.set(slots.skirting);
  }

  private buildTiles(): void {
    if (!this.layout) return;
    if (this.tileMesh) { this.room.remove(this.tileMesh); }
    if (this.tileGeo) {
      this.tileGeo.dispose();
      this.geometries = this.geometries.filter((g) => g !== this.tileGeo);
    }
    const data = buildTileMesh(this.layout, this.mode);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, this.groutMat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.room.add(mesh);
    this.tileMesh = mesh;
    this.tileGeo = geo;
    this.tileData = data;
    this.geometries.push(geo);
    this.applyReveal();
  }

  private applyReveal(): void {
    if (!this.tileGeo || !this.tileData) return;
    if (this.reveal === null) this.tileGeo.setDrawRange(0, Infinity);
    else this.tileGeo.setDrawRange(0, revealCount(this.tileData, this.reveal));
  }

  private buildSkirting(layout: TileLayout): void {
    const h = layout.inputs.skirtingHeightMm / 1000;
    for (const b of skirtingBoards(layout)) {
      const geo = new THREE.BoxGeometry(b.alongX ? b.length : SKIRTING_THICK_M, h, b.alongX ? SKIRTING_THICK_M : b.length);
      const mesh = new THREE.Mesh(geo, this.skirtMat);
      mesh.position.set(b.centre[0], 0.01 + h / 2, b.centre[1]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.geometries.push(geo);
      this.room.add(mesh);
    }
  }

  private buildWalls(layout: TileLayout): void {
    const sky = this.skyMat;
    for (const w of wallPlacements(layout)) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(w.length, 0);
      shape.lineTo(w.length, WALL_HEIGHT_M);
      shape.lineTo(0, WALL_HEIGHT_M);
      shape.closePath();
      if (w.window) {
        const x0 = (w.length - w.window.w) / 2;
        const hole = new THREE.Path();
        hole.moveTo(x0, w.window.sill);
        hole.lineTo(x0 + w.window.w, w.window.sill);
        hole.lineTo(x0 + w.window.w, w.window.sill + w.window.h);
        hole.lineTo(x0, w.window.sill + w.window.h);
        hole.closePath();
        shape.holes.push(hole);
      }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL_THICK_M, bevelEnabled: false });
      const mat = this.wallBase.clone();
      this.ownMaterials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      const xAxis = new THREE.Vector3(w.dir[0], 0, w.dir[1]);
      const zAxis = new THREE.Vector3(w.outward[0], 0, w.outward[1]);
      const basis = new THREE.Matrix4().makeBasis(xAxis, new THREE.Vector3(0, 1, 0), zAxis);
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.position.set(w.origin[0], 0, w.origin[1]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.geometries.push(geo);
      this.room.add(mesh);

      let plane: THREE.Mesh | null = null;
      if (w.window) {
        const pg = new THREE.PlaneGeometry(w.window.w * 4, w.window.h * 4);
        plane = new THREE.Mesh(pg, sky);
        const mid = new THREE.Vector3(w.origin[0], 0, w.origin[1])
          .addScaledVector(xAxis, w.length / 2).addScaledVector(zAxis, WALL_THICK_M + 0.6);
        plane.position.set(mid.x, w.window.sill + w.window.h / 2, mid.z);
        plane.quaternion.setFromRotationMatrix(basis);
        this.geometries.push(pg);
        this.room.add(plane);
      }
      this.walls.push({ mesh, sky: plane, mat, origin: new THREE.Vector3(w.origin[0], 0, w.origin[1]), outward: zAxis });
    }
  }

  private clearRoom(): void {
    this.room.clear();
    this.geometries.forEach((g) => g.dispose());
    this.geometries = [];
    this.walls.forEach((w) => w.mat.dispose());
    this.ownMaterials = this.ownMaterials.filter((m) => !this.walls.some((w) => w.mat === m));
    this.walls = [];
    this.tileMesh = null;
    this.tileGeo = null;
    this.tileData = null;
  }

  // ── drawing ──

  /** Keep drawing every frame for a while (textures arrive after the first frame). */
  private kick(ms = SETTLE_MS): void {
    this.keepUntil = performance.now() + ms;
    this.request();
  }

  private request(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    this.raf = 0;
    if (this.disposed) return;
    const settling = performance.now() < this.keepUntil;
    if (this.dirty || settling) {
      this.dirty = false;
      this.render();
    }
    if (settling) this.schedule();
  };

  private render(): void {
    const pos = cameraPosition([this.target.x, this.target.y, this.target.z], this.orbit);
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.camera.near = Math.max(0.05, this.orbit.dist * 0.02);
    this.camera.far = Math.max(60, this.orbit.maxDist * 4);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.target);
    // A wall the camera is behind would hide the room: it stops drawing (it still throws its shadow).
    for (const w of this.walls) {
      const outside = this.camera.position.clone().sub(w.origin).dot(w.outward) > 0.02;
      w.mat.colorWrite = !outside;
      w.mat.depthWrite = !outside;
      if (w.sky) w.sky.visible = !outside;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.9 ? 52 : 36;
    this.camera.updateProjectionMatrix();
    this.request();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detach();
    this.resizeObs?.disconnect();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onLost);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.onRestored);
    this.clearRoom();
    this.ownMaterials.forEach((m) => m.dispose());
    this.ownMaterials = [];
    this.lib.dispose();
    this.envTexture?.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
