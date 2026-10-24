// Porta cabin rooms and equipment: the catalogue (pure data).
//
// A cabin's interior can be divided into ROOMS of a type, and each room is
// furnished from this catalogue. The geometry module (portaCabin.ts) places the
// items inside the room rectangles (cabinRooms.ts) and emits them as pieces of
// the family "EQ", so the 3D view draws them and the bill of materials counts
// them. The mesh for each `key` is in components/estimator/viewer/equipmentMeshes.ts.
//
// EVERY dimension and price below is an ILLUSTRATIVE placeholder, not any
// supplier's product range. Sizes are metres: `w` runs along the wall the item
// stands against, `t` is its depth into the room, `h` its height.

export type EquipMount =
  /** Stands on the floor. */
  | "floor"
  /** Fixed to a wall at `lift` metres above the floor. */
  | "wall"
  /** Fixed high on an EXTERIOR wall (an indoor air-conditioning unit). */
  | "wall_high"
  /** Fixed to the ceiling. */
  | "ceiling"
  /** Fixed on the outside face of an exterior wall (the outdoor air-conditioning unit). */
  | "outside";

export type EquipItem = {
  key: string;
  label: string;
  w: number;
  h: number;
  t: number;
  mount: EquipMount;
  /** Height of the underside above the floor, for "wall" and "outside" items. */
  lift: number;
  /** The template rate that prices one of them; null when another item's rate covers it. */
  rate: string | null;
  /** Illustrative price of one, used for the starter template's rate. */
  price: number;
  /** Main colour of the item. */
  colour: string;
};

const E = (
  key: string, label: string, w: number, h: number, t: number, mount: EquipMount, lift: number,
  rate: string | null, price: number, colour: string
): EquipItem => ({ key, label, w, h, t, mount, lift, rate, price, colour });

/** About eighteen things a cabin interior is furnished with, plus the outdoor unit of a split. */
export const CABIN_EQUIPMENT: readonly EquipItem[] = [
  E("ac_split", "Air conditioner, wall split (indoor unit)", 0.9, 0.3, 0.22, "wall_high", 0, "ac_cost", 430, "#f2f3f4"),
  E("ac_outdoor", "Air conditioner, outdoor unit", 0.8, 0.55, 0.3, "outside", 0.1, null, 0, "#d9dcdf"),
  E("desk", "Desk", 1.2, 0.75, 0.6, "floor", 0, "desk_cost", 85, "#b58a5a"),
  E("chair", "Chair", 0.45, 0.95, 0.45, "floor", 0, "chair_cost", 45, "#2d3238"),
  E("meeting_table", "Meeting table", 1.8, 0.75, 0.9, "floor", 0, "meeting_table_cost", 210, "#a67c52"),
  E("bed_single", "Bed, single", 1.9, 0.5, 0.9, "floor", 0, "bed_single_cost", 95, "#8a6a4a"),
  E("bed_bunk", "Bed, bunk", 1.9, 1.7, 0.9, "floor", 0, "bed_bunk_cost", 160, "#5d6b7a"),
  E("wardrobe", "Wardrobe / locker", 0.9, 1.9, 0.5, "floor", 0, "wardrobe_cost", 120, "#c9b79c"),
  E("shelf", "Storage shelving", 1.0, 1.8, 0.4, "floor", 0, "shelf_cost", 55, "#7d8791"),
  E("wc", "Toilet (WC)", 0.38, 0.8, 0.66, "floor", 0, "wc_cost", 120, "#f6f6f4"),
  E("basin", "Wash basin", 0.5, 0.85, 0.4, "floor", 0, "basin_cost", 60, "#f6f6f4"),
  E("shower", "Shower", 0.9, 2.0, 0.9, "floor", 0, "shower_cost", 150, "#dfe9ee"),
  E("water_heater", "Water heater", 0.4, 0.55, 0.4, "wall", 1.6, "water_heater_cost", 110, "#eceff1"),
  E("pantry_counter", "Pantry counter with sink", 1.2, 0.9, 0.6, "floor", 0, "pantry_counter_cost", 210, "#d8dcdf"),
  E("fridge", "Refrigerator", 0.6, 1.4, 0.6, "floor", 0, "fridge_cost", 280, "#e6e8ea"),
  E("water_cooler", "Water cooler", 0.32, 1.0, 0.35, "floor", 0, "water_cooler_cost", 140, "#dfe3e6"),
  E("light", "Light fitting", 0.6, 0.04, 0.6, "ceiling", 0, "light_cost", 28, "#fbfbf4"),
  E("socket", "Socket outlet", 0.09, 0.09, 0.03, "wall", 0.3, "socket_cost", 18, "#f4f4f2"),
  E("extinguisher", "Fire extinguisher", 0.16, 0.5, 0.16, "wall", 0.9, "extinguisher_cost", 35, "#c0392b"),
];

const BY_KEY: Readonly<Record<string, EquipItem>> = Object.fromEntries(CABIN_EQUIPMENT.map((i) => [i.key, i]));

export function getCabinEquipment(key: string): EquipItem | null {
  return Object.prototype.hasOwnProperty.call(BY_KEY, key) ? BY_KEY[key] : null;
}

/** Spacing a chair keeps from the desk or table it serves, metres. */
export const CHAIR_GAP_M = 0.05;

// ── Rooms ────────────────────────────────────────────────────────────────────

export type RoomTypeKey = "office" | "meeting" | "bedroom" | "toilet" | "shower" | "pantry" | "store" | "reception";

/** One line of a room's default furniture: `n` of `item`; a desk or table brings `withN` of `withItem` (chairs). */
export type RecipeLine = { item: string; n: number; withItem?: string; withN?: number };

export type RoomType = {
  key: RoomTypeKey;
  label: string;
  /** Narrowest the room can be and still hold its furniture, metres. */
  minW: number;
  /** Whether the room is given a window before the rooms that do not need one. */
  window: boolean;
  /** Default furniture, in the order it is placed. */
  items: readonly RecipeLine[];
};

export const ROOM_TYPES: readonly RoomType[] = [
  { key: "office", label: "Office", minW: 2.4, window: true, items: [
    { item: "desk", n: 2, withItem: "chair", withN: 1 }, { item: "ac_split", n: 1 }, { item: "light", n: 2 }, { item: "socket", n: 2 } ] },
  { key: "reception", label: "Reception / security", minW: 2.0, window: true, items: [
    { item: "desk", n: 1, withItem: "chair", withN: 1 }, { item: "ac_split", n: 1 }, { item: "light", n: 2 }, { item: "socket", n: 2 } ] },
  { key: "meeting", label: "Meeting room", minW: 3.0, window: true, items: [
    { item: "meeting_table", n: 1, withItem: "chair", withN: 6 }, { item: "ac_split", n: 1 }, { item: "light", n: 2 }, { item: "socket", n: 2 } ] },
  { key: "bedroom", label: "Bedroom", minW: 2.4, window: true, items: [
    { item: "bed_bunk", n: 1 }, { item: "wardrobe", n: 1 }, { item: "ac_split", n: 1 }, { item: "light", n: 1 }, { item: "socket", n: 2 } ] },
  { key: "toilet", label: "Toilet", minW: 1.2, window: false, items: [
    { item: "wc", n: 1 }, { item: "basin", n: 1 }, { item: "light", n: 1 } ] },
  { key: "shower", label: "Shower", minW: 1.2, window: false, items: [
    { item: "shower", n: 1 }, { item: "water_heater", n: 1 }, { item: "light", n: 1 } ] },
  { key: "pantry", label: "Pantry / kitchenette", minW: 2.2, window: true, items: [
    { item: "pantry_counter", n: 1 }, { item: "fridge", n: 1 }, { item: "water_heater", n: 1 }, { item: "light", n: 1 }, { item: "socket", n: 2 } ] },
  { key: "store", label: "Store", minW: 1.2, window: false, items: [
    { item: "shelf", n: 2 }, { item: "light", n: 1 }, { item: "socket", n: 1 } ] },
];

const ROOM_BY_KEY: Readonly<Record<string, RoomType>> = Object.fromEntries(ROOM_TYPES.map((r) => [r.key, r]));

export function getRoomType(key: string): RoomType | null {
  return Object.prototype.hasOwnProperty.call(ROOM_BY_KEY, key) ? ROOM_BY_KEY[key] : null;
}

// ── Room plans ───────────────────────────────────────────────────────────────

export const ROOMS_NONE = 0;
export const ROOMS_OFFICE = 1;
export const ROOMS_ACCOMMODATION = 2;
export const ROOMS_TOILET_BLOCK = 3;
export const ROOMS_SITE_OFFICE_WC = 4;
export const ROOMS_CUSTOM = 5;

export const ROOM_PLANS = [
  { value: ROOMS_NONE, key: "none", label: "None" },
  { value: ROOMS_OFFICE, key: "office_block", label: "Office block" },
  { value: ROOMS_ACCOMMODATION, key: "accommodation", label: "Accommodation" },
  { value: ROOMS_TOILET_BLOCK, key: "toilet_block", label: "Toilet block" },
  { value: ROOMS_SITE_OFFICE_WC, key: "site_office_wc", label: "Site office with WC" },
  { value: ROOMS_CUSTOM, key: "custom", label: "Custom" },
] as const;

/** Most rooms in one unit (three partitions), the same cap as the partition input. */
export const MAX_ROOMS_PER_UNIT = 4;

/** How many of each room type the Custom plan asks for. */
export type CustomRooms = { office: number; bedroom: number; toilet: number; pantry: number };

const TOILET_ROW: readonly RoomTypeKey[][] = [
  ["toilet"], ["toilet", "shower"], ["toilet", "toilet", "shower"], ["toilet", "toilet", "shower", "shower"],
];

/** The room types of every unit, in order, before they are trimmed to what the unit's length can hold. */
function wanted(mode: number, i: number, n: number, UL: number, custom: CustomRooms): RoomTypeKey[] {
  const last = i === n - 1;
  switch (mode) {
    case ROOMS_OFFICE:
      if (n === 1) return ["office", "pantry"];
      if (i === 0) return ["reception", "office"];
      if (last) return ["meeting", "pantry"];
      return ["office", "office"];
    case ROOMS_ACCOMMODATION:
      if (n === 1) return ["bedroom", "toilet"];
      return last ? ["bedroom", "toilet"] : ["bedroom", "bedroom"];
    case ROOMS_TOILET_BLOCK: {
      const r = Math.max(1, Math.min(MAX_ROOMS_PER_UNIT, Math.floor(UL / 1.5)));
      return TOILET_ROW[r - 1];
    }
    case ROOMS_SITE_OFFICE_WC:
      if (n === 1 || i === 0) return ["office", "toilet"];
      if (n === 2) return ["office", "pantry"];
      return last ? ["meeting", "pantry"] : ["office"];
    default:
      return [];
  }
}

/** Drop rooms from the end until the remaining ones are each wide enough for their furniture. */
function trim(types: RoomTypeKey[], UL: number): RoomTypeKey[] {
  const out = types.slice(0, MAX_ROOMS_PER_UNIT);
  while (out.length > 1 && UL / out.length < Math.max(...out.map((t) => getRoomType(t)!.minW))) out.pop();
  return out;
}

/**
 * The room types of every unit (cell order) for a plan. Every unit gets at least one room, so the equipment and the
 * bill of materials never skip a unit. Pure.
 */
export function planRooms(mode: number, units: number, UL: number, custom: CustomRooms = { office: 0, bedroom: 0, toilet: 0, pantry: 0 }): RoomTypeKey[][] {
  if (mode === ROOMS_NONE || units < 1) return [];
  if (mode === ROOMS_CUSTOM) {
    const list: RoomTypeKey[] = [
      ...Array<RoomTypeKey>(custom.office).fill("office"), ...Array<RoomTypeKey>(custom.bedroom).fill("bedroom"),
      ...Array<RoomTypeKey>(custom.toilet).fill("toilet"), ...Array<RoomTypeKey>(custom.pantry).fill("pantry"),
    ];
    const base = Math.floor(list.length / units);
    const extra = list.length % units;
    let at = 0;
    const out: RoomTypeKey[][] = [];
    for (let u = 0; u < units; u++) {
      const take = Math.min(MAX_ROOMS_PER_UNIT, base + (u < extra ? 1 : 0));
      const mine = list.slice(at, at + take);
      at += take;
      out.push(mine.length === 0 ? ["store"] : trim(mine, UL));
    }
    return out;
  }
  return Array.from({ length: units }, (_, i) => trim(wanted(mode, i, units, UL, custom), UL));
}
