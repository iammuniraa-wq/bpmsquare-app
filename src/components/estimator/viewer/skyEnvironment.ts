// The sky the 3D estimate stands under: a gradient dome behind the scene and a matching environment map
// (generated here, no HDR file to download) that lights and reflects off the PBR materials. Two palettes,
// day and dark, picked from the host's theme.

import * as THREE from "three";

export type SkyPalette = {
  zenith: string;
  horizon: string;
  /** Light bounced up from the ground, used below the horizon of the environment map. */
  bounce: string;
  sun: string;
  /** Directional light strength. */
  sunLight: number;
  /** Scene.environmentIntensity. */
  env: number;
  exposure: number;
  /** Multiplies the ground texture so the ground sits in the theme (dark mode darkens it). */
  groundTint: string;
};

const DAY: SkyPalette = {
  zenith: "#5f98d6", horizon: "#dbe8f3", bounce: "#9a9486", sun: "#fff3dc", sunLight: 2.6, env: 0.85, exposure: 1, groundTint: "#ffffff",
};
const DARK: SkyPalette = {
  zenith: "#3a5a8a", horizon: "#7d97bb", bounce: "#6a6a6a", sun: "#e6edff", sunLight: 2.3, env: 0.85, exposure: 1.5, groundTint: "#e0e0e0",
};

/** The Middle East look: a hazy sand horizon, a warm sun and a sand ground, so a fence reads cleanly against it. */
const DESERT_DAY: SkyPalette = {
  zenith: "#78aee0", horizon: "#f1e2c8", bounce: "#cdb084", sun: "#fff0d2", sunLight: 2.8, env: 0.9, exposure: 1, groundTint: "#ffffff",
};
const DESERT_DARK: SkyPalette = {
  zenith: "#44648f", horizon: "#a8967a", bounce: "#7a6c58", sun: "#ffeccc", sunLight: 2.4, env: 0.85, exposure: 1.5, groundTint: "#d8cdb8",
};

/** Relative luminance 0..1 of a "#rrggbb" colour (sRGB, no gamma decode: it only has to tell a dark theme from a light one). */
export function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** The theme's ground colour (--est-ground) is a light sand in the light theme and near black in the dark one. */
export function isDarkTheme(groundHex: string): boolean {
  return hexLuminance(groundHex) < 0.3;
}

export function skyPalette(dark: boolean, desert = false): SkyPalette {
  if (desert) return dark ? DESERT_DARK : DESERT_DAY;
  return dark ? DARK : DAY;
}

export const SUN_DIRECTION = new THREE.Vector3(34, 55, 26).normalize();

const SKY_SEGMENTS: [number, number] = [24, 14];

function skySphere(radius: number, colourAt: (y: number) => THREE.Color): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, SKY_SEGMENTS[0], SKY_SEGMENTS[1]);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = colourAt(pos.getY(i) / radius);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/** The dome drawn behind everything (unit radius; the scene scales it to the camera's far plane). */
export function createSkyDome(p: SkyPalette): THREE.Mesh {
  const zenith = new THREE.Color(p.zenith);
  const horizon = new THREE.Color(p.horizon);
  return skySphere(1, (y) => (y <= 0 ? horizon.clone() : horizon.clone().lerp(zenith, Math.pow(y, 0.55))));
}

/** The scene PMREMGenerator turns into the environment map: sky above, bounced ground below, a bright sun disc. */
export function createEnvironmentScene(p: SkyPalette): THREE.Scene {
  const zenith = new THREE.Color(p.zenith);
  const horizon = new THREE.Color(p.horizon);
  const bounce = new THREE.Color(p.bounce);
  const scene = new THREE.Scene();
  scene.add(skySphere(50, (y) => (y >= 0 ? horizon.clone().lerp(zenith, Math.pow(y, 0.55)) : horizon.clone().lerp(bounce, Math.min(1, -y * 3)))));
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 12, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(p.sun).multiplyScalar(p.sunLight * 9), fog: false })
  );
  disc.position.copy(SUN_DIRECTION).multiplyScalar(44);
  scene.add(disc);
  return scene;
}

/** Free the dome or environment scene made above. */
export function disposeSky(root: THREE.Object3D): void {
  root.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat) mat.dispose();
  });
}
