"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { FenceGateInput, FenceGeometryResult, FenceLayout } from "@/lib/fence/geometry";

// Real-time 3D preview (Phase E, docs/fence-configurator-architecture.md
// §9) -- renders the SAME FenceGeometryResult the plan view and the BOM
// already consume; one geometry source, two views, never two
// calculations. Deliberately plain: no warehouse context, no shadows/tone
// mapping, no site-vs-studio toggle -- that visual work is explicitly
// deferred (owner instruction 2026-09-07: beautification after everything
// is built and seen on the real bigblue tenant). This proves the
// mechanism -- live orbit, live rebuild on every input -- not the final look.
//
// Plain three.js + refs, not react-three-fiber: no such dependency exists
// in this codebase yet, and one imperative scene managed through a ref is
// the same shape as the concept artifacts already validated (see the
// architecture doc's §1b UX bar) without adding a second new dependency.
// Drag tracking lives on `window`, not native pointer capture, for the
// same reason the concept version was fixed to: the canvas can be
// reparented by a parent re-render, and capture on a moved node swallows
// clicks elsewhere on the page.

interface Fence3DViewProps {
  layout: FenceLayout;
  totalLength: number;
  gates: FenceGateInput[];
  fabricHeight: number;
  geometry: FenceGeometryResult;
  coating: string;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  theta: number;
  phi: number;
  radius: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
  raf: number | null;
}

function disposeGroup(group: THREE.Group) {
  while (group.children.length) {
    const obj = group.children.pop()!;
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m.dispose());
    }
  }
}

function chainLinkTexture(coating: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const tint = coating === "GI" ? "#c7cdd2" : coating === "Powder coated" ? "#2b2f33" : "#3f6b46";
  ctx.strokeStyle = tint;
  ctx.lineWidth = 2.2;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  for (let i = -64; i < 128; i += 16) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 64, 64);
    ctx.moveTo(i + 64, 0);
    ctx.lineTo(i, 64);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildFence(group: THREE.Group, props: Fence3DViewProps) {
  const { layout, totalLength, gates, fabricHeight, geometry, coating } = props;
  const scale = Math.max(0.4, Math.min(1, totalLength / 900));
  const W = 6 + scale * 16;
  const H = 5 + scale * 12;
  const postH = 1.6 + fabricHeight * 0.9;
  const postMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ac, metalness: 0.4, roughness: 0.5 });
  const cornerMat = new THREE.MeshStandardMaterial({ color: 0x818b93, metalness: 0.4, roughness: 0.5 });
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x6c7680, metalness: 0.4, roughness: 0.5 });
  const tex = chainLinkTexture(coating);

  function addPost(x: number, z: number, tall: number, mat: THREE.Material, r: number) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, tall, 10), mat);
    mesh.position.set(x, tall / 2, z);
    group.add(mesh);
  }
  function addFabricSeg(x1: number, z1: number, angle: number, s0: number, s1: number) {
    if (s1 - s0 <= 0.05) return;
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set((s1 - s0) / 1.1, fabricHeight / 1.1);
    const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, opacity: 0.8, side: THREE.DoubleSide, roughness: 0.9 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s1 - s0, fabricHeight), mat);
    const mid = s0 + (s1 - s0) / 2;
    mesh.position.set(x1 + Math.cos(angle) * mid, fabricHeight / 2, z1 + Math.sin(angle) * mid);
    mesh.rotation.y = -angle;
    group.add(mesh);
  }

  const pxPerM = W / Math.max(1, totalLength);

  if (layout === "closed_perimeter") {
    const pts: [number, number][] = [
      [-W / 2, -H / 2],
      [W / 2, -H / 2],
      [W / 2, H / 2],
      [-W / 2, H / 2],
    ];
    pts.forEach(([x, z]) => addPost(x, z, postH + 0.3, cornerMat, 0.09));

    const perEdge = Math.max(1, Math.round(geometry.line_posts / 4));
    const edges: [[number, number], [number, number]][] = [
      [pts[0], pts[1]],
      [pts[1], pts[2]],
      [pts[2], pts[3]],
      [pts[3], pts[0]],
    ];
    edges.forEach(([a, b], ei) => {
      const isBottom = ei === 2 && gates.length > 0;
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (!isBottom) {
        for (let i = 1; i <= perEdge; i++) {
          const t = i / (perEdge + 1);
          addPost(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, postH, postMat, 0.045);
        }
        addFabricSeg(a[0], a[1], angle, 0, Math.hypot(b[0] - a[0], b[1] - a[1]));
      } else {
        const runLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let cursor = 0.4;
        addFabricSeg(a[0], a[1], angle, 0, cursor);
        gates.forEach((g, gi) => {
          const gw = Math.min(runLen * 0.35, Math.max(0.8, g.width_m * pxPerM * 3));
          const px1 = a[0] + Math.cos(angle) * cursor;
          const pz1 = a[1] + Math.sin(angle) * cursor;
          const px2 = a[0] + Math.cos(angle) * (cursor + gw);
          const pz2 = a[1] + Math.sin(angle) * (cursor + gw);
          addPost(px1, pz1, postH + 0.2, gateMat, 0.06);
          addPost(px2, pz2, postH + 0.2, gateMat, 0.06);
          cursor += gw + 0.3;
          if (gi < gates.length - 1) {
            const gap = Math.max(0.3, (runLen - 0.8 - gw * gates.length) / Math.max(1, gates.length));
            addFabricSeg(a[0], a[1], angle, cursor, cursor + gap);
            cursor += gap;
          }
        });
        addFabricSeg(a[0], a[1], angle, cursor, runLen);
      }
    });
  } else {
    addPost(-W / 2, 0, postH + 0.3, cornerMat, 0.09);
    addPost(W / 2, 0, postH + 0.3, cornerMat, 0.09);
    const n = Math.max(1, Math.round(geometry.line_posts));
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      addPost(-W / 2 + W * t, 0, postH, postMat, 0.045);
    }
    addFabricSeg(-W / 2, 0, 0, 0, W);
  }
}

export default function Fence3DView(props: Fence3DViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<SceneState | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth || 400;
    const h = mount.clientHeight || 300;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(10, 20, 10);
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);
    scene.add(new THREE.GridHelper(120, 40, 0x9c8f6e, 0xcac1ab));

    const group = new THREE.Group();
    scene.add(group);

    const st: SceneState = { renderer, scene, camera, group, theta: 0.7, phi: 1.0, radius: 20, dragging: false, lastX: 0, lastY: 0, raf: null };
    stateRef.current = st;

    function onWinMove(e: PointerEvent) {
      if (!st.dragging) return;
      const dx = e.clientX - st.lastX;
      const dy = e.clientY - st.lastY;
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      st.theta -= dx * 0.007;
      st.phi = Math.max(0.2, Math.min(1.5, st.phi - dy * 0.007));
    }
    function onWinUp() {
      st.dragging = false;
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
    }
    function onDown(e: PointerEvent) {
      st.dragging = true;
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      window.addEventListener("pointermove", onWinMove);
      window.addEventListener("pointerup", onWinUp);
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      st.radius = Math.max(6, Math.min(60, st.radius + e.deltaY * 0.02));
    }
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    function tick() {
      const x = st.radius * Math.sin(st.phi) * Math.cos(st.theta);
      const y = st.radius * Math.cos(st.phi) + 1;
      const z = st.radius * Math.sin(st.phi) * Math.sin(st.theta);
      camera.position.set(x, y, z);
      camera.lookAt(0, 1, 0);
      renderer.render(scene, camera);
      st.raf = requestAnimationFrame(tick);
    }
    st.raf = requestAnimationFrame(tick);

    function onResize() {
      if (!mount) return;
      const ww = mount.clientWidth || 400;
      const hh = mount.clientHeight || 300;
      camera.aspect = ww / hh;
      camera.updateProjectionMatrix();
      renderer.setSize(ww, hh);
    }
    window.addEventListener("resize", onResize);

    return () => {
      if (st.raf) cancelAnimationFrame(st.raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("wheel", onWheel);
      disposeGroup(group);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
    // Scene/camera/renderer are set up once; prop-driven rebuilds happen
    // in the effect below via the same group reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    disposeGroup(st.group);
    buildFence(st.group, props);
    // props is a fresh object every render; depend on its actual fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.layout, props.totalLength, props.gates, props.fabricHeight, props.geometry, props.coating]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}
