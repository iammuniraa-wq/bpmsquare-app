// How each item of the cabin equipment catalogue (lib/estimator/geometry/cabinEquipment.ts) is drawn:
// a handful of boxes and cylinders sized from the piece, so the picture always matches the piece's
// dimensions. Items are drawn facing +z with their back at -z (the side a wall mount fixes to); the
// piece's rotation turns them to face into the room.

import type * as THREE from "three";
import type { Parts } from "./equipmentParts";

export type ShapeDims = { w: number; h: number; t: number };

/** The materials a shape draws with. `body` is the item's own colour, or the design attribute's. */
export type ShapeMaterials = {
  body: THREE.Material;
  /** A plain colour, "#rrggbb". */
  c: (hex: string) => THREE.Material;
  glass: THREE.Material;
  metal: THREE.Material;
};

type Shape = (p: Parts, d: ShapeDims, m: ShapeMaterials) => void;

const WHITE = "#f4f5f6";
const DARK = "#2a2e33";
const GREY = "#8a9096";
const LIGHT_GREY = "#d5d9dd";
const WOOD = "#a67c52";

const acSplit: Shape = (p, { w, h, t }, m) => {
  p.box(m.body, w, h * 0.74, t, 0, h * 0.13, 0);
  p.box(m.body, w * 0.98, h * 0.26, t * 0.82, 0, -h * 0.37, -t * 0.06);
  p.box(m.c(DARK), w * 0.84, 0.012, 0.012, 0, -h * 0.22, t * 0.43); // the louvre line
  p.box(m.c(GREY), w * 0.1, 0.01, 0.006, w * 0.36, h * 0.3, t * 0.505); // the display
};

const acOutdoor: Shape = (p, { w, h, t }, m) => {
  p.box(m.body, w, h, t, 0, 0, 0);
  p.cylZ(m.c(DARK), Math.min(w, h) * 0.38, 0.012, -w * 0.08, 0, t / 2 + 0.002); // the fan guard
  p.cylZ(m.c(GREY), Math.min(w, h) * 0.12, 0.016, -w * 0.08, 0, t / 2 + 0.004);
  for (let i = 0; i < 4; i++) p.box(m.c(DARK), 0.006, h * 0.7, 0.01, w * 0.36 + i * 0.012 - 0.018, 0, t / 2 + 0.002); // side louvres
};

const desk: Shape = (p, { w, h, t }, m) => {
  p.box(m.body, w, 0.04, t, 0, h / 2 - 0.02, 0);
  p.box(m.c(DARK), 0.04, h - 0.04, t * 0.92, -w / 2 + 0.03, -0.02, 0); // left panel
  p.box(m.c(DARK), 0.04, h - 0.04, t * 0.92, w / 2 - 0.03, -0.02, 0);
  p.box(m.c(DARK), w - 0.1, h * 0.4, 0.02, 0, h * 0.2, -t / 2 + 0.05); // modesty panel
  p.box(m.c("#5a5f66"), w * 0.3, h * 0.4, t * 0.8, w * 0.32, h * 0.1 - 0.02, 0); // drawer unit
  p.box(m.c(LIGHT_GREY), w * 0.18, 0.012, 0.012, w * 0.32, h * 0.2, t * 0.4 + 0.006); // its handle
  // a monitor, keyboard and mouse on top
  p.box(m.c(DARK), 0.5, 0.3, 0.025, -w * 0.12, h / 2 + 0.28, -t * 0.22);
  p.box(m.c(DARK), 0.04, 0.12, 0.04, -w * 0.12, h / 2 + 0.1, -t * 0.22);
  p.box(m.c(DARK), 0.2, 0.012, 0.14, -w * 0.12, h / 2 + 0.026, -t * 0.22);
  p.box(m.c(LIGHT_GREY), 0.38, 0.012, 0.13, -w * 0.12, h / 2 + 0.026, t * 0.12);
  p.box(m.c(LIGHT_GREY), 0.05, 0.015, 0.08, w * 0.08, h / 2 + 0.027, t * 0.12);
};

const chair: Shape = (p, { w, h, t }, m) => {
  const seatY = -h / 2 + h * 0.48;
  p.box(m.body, w * 0.94, 0.06, t * 0.94, 0, seatY, 0.01);
  p.box(m.body, w * 0.88, h * 0.4, 0.05, 0, seatY + h * 0.24, -t / 2 + 0.05); // the back
  p.cyl(m.metal, 0.025, 0.025, h * 0.38, 0, -h / 2 + h * 0.25, 0);
  p.box(m.metal, w * 0.9, 0.03, 0.05, 0, -h / 2 + 0.05, 0, 0);
  p.box(m.metal, w * 0.9, 0.03, 0.05, 0, -h / 2 + 0.05, 0, Math.PI / 2);
  p.box(m.metal, w * 0.8, 0.03, 0.05, 0, -h / 2 + 0.05, 0, Math.PI / 4);
  p.box(m.metal, w * 0.8, 0.03, 0.05, 0, -h / 2 + 0.05, 0, -Math.PI / 4);
};

const meetingTable: Shape = (p, { w, h, t }, m) => {
  p.box(m.body, w, 0.045, t, 0, h / 2 - 0.0225, 0);
  p.box(m.c(DARK), 0.06, h - 0.05, t * 0.7, -w / 2 + 0.22, -0.025, 0);
  p.box(m.c(DARK), 0.06, h - 0.05, t * 0.7, w / 2 - 0.22, -0.025, 0);
  p.box(m.c(DARK), w - 0.5, 0.05, 0.05, 0, -h * 0.1, 0);
};

const bedSingle: Shape = (p, { w, h, t }, m) => {
  // The head is at -x.
  p.box(m.c(WOOD), w, 0.1, t, 0, -h / 2 + 0.17, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(m.c(WOOD), 0.06, 0.14, 0.06, sx * (w / 2 - 0.05), -h / 2 + 0.07, sz * (t / 2 - 0.05));
  p.box(m.body, w - 0.06, 0.16, t - 0.06, 0, -h / 2 + 0.3, 0); // the mattress
  p.box(m.c("#6f8fa8"), w * 0.62, 0.02, t - 0.04, w * 0.17, -h / 2 + 0.39, 0); // the blanket
  p.box(m.c(WHITE), 0.4, 0.08, t * 0.6, -w / 2 + 0.3, -h / 2 + 0.42, 0); // the pillow
  p.box(m.c(WOOD), 0.05, h * 0.85, t, -w / 2 + 0.025, -h / 2 + h * 0.42, 0); // the headboard
};

const bedBunk: Shape = (p, { w, h, t }, m) => {
  const lowY = -h / 2 + 0.42;
  const highY = -h / 2 + 1.12;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(m.metal, 0.05, h, 0.05, sx * (w / 2 - 0.03), 0, sz * (t / 2 - 0.03));
  for (const y of [lowY, highY]) {
    p.box(m.c(DARK), w - 0.06, 0.05, t - 0.06, 0, y, 0);
    p.box(m.body, w - 0.1, 0.14, t - 0.1, 0, y + 0.095, 0);
    p.box(m.c(WHITE), 0.4, 0.08, t * 0.6, -w / 2 + 0.3, y + 0.2, 0);
    p.box(m.c("#6f8fa8"), w * 0.55, 0.02, t - 0.1, w * 0.18, y + 0.175, 0);
  }
  p.box(m.metal, w - 0.1, 0.25, 0.025, 0, highY + 0.2, t / 2 - 0.025); // the guard rail of the top bunk
  // ladder at the foot end
  for (const x of [w / 2 - 0.3, w / 2 - 0.08]) p.box(m.metal, 0.03, 1.15, 0.03, x, -h / 2 + 0.6, t / 2 + 0.02);
  for (let i = 0; i < 4; i++) p.box(m.metal, 0.22, 0.03, 0.03, w / 2 - 0.19, -h / 2 + 0.25 + i * 0.28, t / 2 + 0.02);
};

const wardrobe: Shape = (p, { w, h, t }, m) => {
  p.box(m.body, w, h - 0.06, t, 0, 0.03, 0);
  p.box(m.c(DARK), w - 0.04, 0.06, t - 0.04, 0, -h / 2 + 0.03, 0); // the plinth
  p.box(m.c(DARK), 0.006, h - 0.12, 0.006, 0, 0.03, t / 2 + 0.002); // the gap between the doors
  p.box(m.c(DARK), 0.006, 0.006, 0.006, 0, 0, t / 2);
  p.box(m.c(LIGHT_GREY), 0.02, 0.16, 0.02, -0.04, 0, t / 2 + 0.012);
  p.box(m.c(LIGHT_GREY), 0.02, 0.16, 0.02, 0.04, 0, t / 2 + 0.012);
};

const shelf: Shape = (p, { w, h, t }, m) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(m.body, 0.04, h, 0.04, sx * (w / 2 - 0.02), 0, sz * (t / 2 - 0.02));
  for (let i = 0; i < 5; i++) p.box(m.body, w, 0.03, t, 0, -h / 2 + 0.05 + i * ((h - 0.1) / 4), 0);
  const box = m.c("#b08d5f");
  p.box(box, 0.34, 0.3, 0.3, -w * 0.25, -h / 2 + 0.05 + 0.18, 0);
  p.box(box, 0.3, 0.22, 0.3, w * 0.2, -h / 2 + 0.05 + 0.15, 0);
  p.box(box, 0.4, 0.26, 0.3, -w * 0.15, -h / 2 + 0.05 + 2 * ((h - 0.1) / 4) + 0.16, 0);
  p.box(m.c("#4f6b86"), 0.3, 0.2, 0.28, w * 0.25, -h / 2 + 0.05 + 3 * ((h - 0.1) / 4) + 0.13, 0);
};

const wc: Shape = (p, { w, h, t }, m) => {
  const bowlLen = t * 0.72;
  p.cyl(m.body, w * 0.5, w * 0.34, h * 0.5, 0, -h / 2 + h * 0.25, t / 2 - bowlLen / 2, 1, bowlLen / w); // the bowl
  p.cyl(m.c(WHITE), w * 0.5, w * 0.5, 0.025, 0, -h / 2 + h * 0.5 + 0.0125, t / 2 - bowlLen / 2, 1, bowlLen / w); // the seat
  p.box(m.body, w * 0.52, h * 0.52, 0.14, 0, -h / 2 + h * 0.5 - 0.02, -t / 2 + 0.19); // pedestal behind the bowl
  p.box(m.body, w * 0.96, h * 0.42, 0.19, 0, h / 2 - h * 0.21, -t / 2 + 0.095); // the cistern
  p.box(m.c(WHITE), w * 0.98, 0.025, 0.2, 0, h / 2 + 0.0125 - 0.003, -t / 2 + 0.1);
  p.cyl(m.metal, 0.02, 0.02, 0.02, 0, h / 2 + 0.02, -t / 2 + 0.1); // the flush button
};

const basin: Shape = (p, { w, h, t }, m) => {
  p.cyl(m.body, 0.05, 0.07, h * 0.6, 0, -h / 2 + h * 0.3, -t * 0.1); // the pedestal
  p.box(m.body, w, 0.14, t, 0, h / 2 - 0.07, 0); // the bowl
  p.box(m.c("#dfe3e6"), w * 0.78, 0.01, t * 0.7, 0, h / 2 + 0.002, 0.02); // the hollow
  p.box(m.body, w, 0.1, 0.03, 0, h / 2 + 0.03, -t / 2 + 0.015); // the back edge
  p.cyl(m.metal, 0.012, 0.012, 0.1, 0, h / 2 + 0.07, -t * 0.28); // the tap
  p.box(m.metal, 0.018, 0.018, 0.09, 0, h / 2 + 0.115, -t * 0.28 + 0.045);
};

const shower: Shape = (p, { w, h, t }, m) => {
  p.box(m.body, w, 0.06, t, 0, -h / 2 + 0.03, 0); // the tray
  p.box(m.c(DARK), 0.08, 0.008, 0.08, 0, -h / 2 + 0.062, 0);
  p.box(m.glass, w - 0.04, h - 0.12, 0.012, 0, 0.03, t / 2 - 0.006); // front panel
  p.box(m.glass, 0.012, h - 0.12, t - 0.04, w / 2 - 0.006, 0.03, 0); // side panel
  for (const [x, z] of [[w / 2 - 0.006, t / 2 - 0.006], [-w / 2 + 0.02, t / 2 - 0.006], [w / 2 - 0.006, -t / 2 + 0.02]]) p.box(m.metal, 0.025, h - 0.1, 0.025, x, 0.04, z);
  p.box(m.metal, w - 0.02, 0.025, 0.025, 0, h / 2 - 0.05, t / 2 - 0.006);
  p.cyl(m.metal, 0.012, 0.012, h * 0.62, -w / 2 + 0.07, 0.1, -t / 2 + 0.05); // the riser
  p.box(m.metal, 0.012, 0.012, 0.16, -w / 2 + 0.07, h / 2 - 0.3, -t / 2 + 0.12);
  p.cyl(m.metal, 0.07, 0.07, 0.015, -w / 2 + 0.07, h / 2 - 0.31, -t / 2 + 0.2); // the head
};

const waterHeater: Shape = (p, { w, h, t }, m) => {
  p.cyl(m.body, w * 0.5, w * 0.5, h * 0.84, 0, 0.02, 0, 1, t / w);
  p.cyl(m.c(GREY), w * 0.22, w * 0.22, h * 0.08, 0, h / 2 - h * 0.04, 0);
  p.cyl(m.c(GREY), w * 0.22, w * 0.22, h * 0.08, 0, -h / 2 + h * 0.04, 0);
  p.cyl(m.metal, 0.012, 0.012, 0.1, -w * 0.15, -h / 2 - 0.0, t * 0.1); // the two pipes
  p.cyl(m.metal, 0.012, 0.012, 0.1, w * 0.15, -h / 2 - 0.0, t * 0.1);
  p.box(m.c("#3a8f5a"), 0.012, 0.012, 0.004, 0, 0.1, t / 2 * 0.99); // the indicator
};

const pantryCounter: Shape = (p, { w, h, t }, m) => {
  p.box(m.body, w, h - 0.04, t, 0, -0.02, 0); // the cabinet
  p.box(m.c("#3b4046"), w + 0.02, 0.04, t + 0.02, 0, h / 2 - 0.02, 0.005); // the worktop
  p.box(m.metal, w * 0.36, 0.012, t * 0.62, -w * 0.24, h / 2 + 0.002, 0.01); // the sink
  p.box(m.c("#6b7178"), w * 0.28, 0.006, t * 0.5, -w * 0.24, h / 2 + 0.009, 0.01);
  p.cyl(m.metal, 0.014, 0.014, 0.16, -w * 0.24, h / 2 + 0.1, -t * 0.34); // the tap
  p.box(m.metal, 0.02, 0.02, 0.11, -w * 0.24, h / 2 + 0.18, -t * 0.34 + 0.055);
  p.box(m.c(DARK), 0.006, h - 0.1, 0.006, 0, -0.03, t / 2 + 0.002); // door lines
  p.box(m.c(DARK), 0.006, h - 0.1, 0.006, w * 0.3, -0.03, t / 2 + 0.002);
  p.box(m.c(LIGHT_GREY), 0.14, 0.015, 0.015, w * 0.15, h * 0.25, t / 2 + 0.01);
  p.box(m.c(LIGHT_GREY), 0.14, 0.015, 0.015, w * 0.4, h * 0.25, t / 2 + 0.01);
};

const fridge: Shape = (p, { w, h, t }, m) => {
  p.box(m.body, w, h, t, 0, 0, 0);
  p.box(m.c(DARK), w - 0.02, 0.006, 0.006, 0, h / 2 - 0.42, t / 2 + 0.002); // freezer door line
  p.box(m.c(GREY), 0.022, 0.2, 0.03, w / 2 - 0.07, h / 2 - 0.25, t / 2 + 0.015);
  p.box(m.c(GREY), 0.022, 0.32, 0.03, w / 2 - 0.07, h / 2 - 0.72, t / 2 + 0.015);
};

const waterCooler: Shape = (p, { w, h, t }, m) => {
  p.box(m.body, w, h * 0.7, t, 0, -h / 2 + h * 0.35, 0);
  p.box(m.c(DARK), w * 0.8, 0.02, t * 0.5, 0, -h / 2 + 0.2, t * 0.24); // the drip tray
  p.box(m.c("#c0392b"), 0.03, 0.03, 0.03, -w * 0.18, -h / 2 + 0.34, t / 2 + 0.01); // hot tap
  p.box(m.c("#2e6fb0"), 0.03, 0.03, 0.03, w * 0.18, -h / 2 + 0.34, t / 2 + 0.01); // cold tap
  p.cyl(m.glass, 0.12, 0.12, h * 0.24, 0, h / 2 - h * 0.13, 0); // the bottle
  p.cyl(m.glass, 0.04, 0.12, 0.03, 0, h / 2 - 0.005, 0);
};

const light: Shape = (p, { w, h, t }, m) => {
  p.box(m.c(LIGHT_GREY), w, h, t, 0, 0, 0);
  p.box(m.c("#fffdf0"), w * 0.9, 0.006, t * 0.9, 0, -h / 2 - 0.001, 0);
};

const socket: Shape = (p, { w, h, t }, m) => {
  p.box(m.c(WHITE), w, h, t * 0.5, 0, 0, -t / 2 + t * 0.25);
  p.box(m.c(DARK), 0.012, 0.026, 0.004, -0.015, 0.008, -t / 2 + t * 0.5);
  p.box(m.c(DARK), 0.012, 0.026, 0.004, 0.015, 0.008, -t / 2 + t * 0.5);
  p.box(m.c(DARK), 0.014, 0.014, 0.004, 0, -0.018, -t / 2 + t * 0.5);
};

const extinguisher: Shape = (p, { w, h, t }, m) => {
  p.cyl(m.body, w * 0.46, w * 0.46, h * 0.68, 0, -h / 2 + h * 0.34, 0);
  p.cyl(m.c(DARK), w * 0.2, w * 0.3, h * 0.08, 0, -h / 2 + h * 0.72, 0);
  p.box(m.c(DARK), w * 0.5, 0.025, 0.03, 0, h / 2 - 0.05, 0);
  p.cyl(m.c(DARK), 0.012, 0.012, h * 0.34, w * 0.3, -h / 2 + h * 0.5, t * 0.35); // the hose
  p.box(m.c(LIGHT_GREY), w * 0.9, 0.02, 0.02, 0, -h / 2 + h * 0.5, -t / 2 + 0.01); // the wall strap
  p.box(m.c(WHITE), w * 0.5, h * 0.18, 0.004, 0, -h / 2 + h * 0.36, t * 0.46); // the label
};

export const SHAPES: Readonly<Record<string, Shape>> = {
  ac_split: acSplit, ac_outdoor: acOutdoor, desk, chair, meeting_table: meetingTable,
  bed_single: bedSingle, bed_bunk: bedBunk, wardrobe, shelf, wc, basin, shower,
  water_heater: waterHeater, pantry_counter: pantryCounter, fridge, water_cooler: waterCooler,
  light, socket, extinguisher,
};
