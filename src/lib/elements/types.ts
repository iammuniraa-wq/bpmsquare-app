// Buildings and element codes (docs/design/pcbs-buildings-elements.md). Plain types and constants, no I/O and no server imports, so the routes,
// the screens and the tests read the same words. Tables and columns: migrations 0253 and 0254. Generic: the first user is a precast contractor,
// but nothing here names a tenant. A workspace without precast can call a building an "Area" or a "Phase" (level names, a display setting only).

export const BUILDING_CODE_RE = /^[A-Z0-9]{1,6}$/;
export const TYPE_CODE_RE = /^[A-Z0-9]{2,5}$/;
export const ELEMENT_CODE_RE = /^[A-Z0-9][A-Z0-9._/-]*$/;

export const ELEMENT_LIMITS = {
  /** The default longest element code: the F&O item-number length (question 3 of the design). A workspace can lower or raise it, to the hard limit. */
  codeMaxDefault: 20,
  codeMaxHard: 40,
  buildingMax: 6,
  typeMax: 5,
  patternMax: 80,
  /** A line's quantities (a budget line holds numeric(14,3)). */
  qtyMax: 999_999_999,
  /** Rows in one model comparison. */
  maxModelRows: 5000,
} as const;

/** The site-wide building: transport, mobilisation and other items that belong to no building (made on demand, code COM). */
export const COMMON_BUILDING = { code: "COM", name: "Common" } as const;

/** B01-HCS-0007: building, element type, a running number of four digits. */
export const DEFAULT_PATTERN = "{building}-{type}-{seq:4}";
export const DEFAULT_TOLERANCE_PCT = 5;

export type LevelNames = { building: string; activity: string; cost_element: string };
export const DEFAULT_LEVEL_NAMES: LevelNames = { building: "Building", activity: "Activity", cost_element: "Cost element" };

/** `tenants.config.contract_elements`: one workspace setting, edited in Settings > Contract projects. Every key optional; the defaults above apply. */
export type ContractElementsConfig = {
  pattern?: string;
  code_max?: number;
  qty_tolerance_pct?: number;
  level_names?: Partial<LevelNames>;
};

export type ElementsSettings = { pattern: string; code_max: number; qty_tolerance_pct: number; level_names: LevelNames };

const cleanName = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 30) : fallback);

/** The workspace's settings with every default filled in; a bad stored value falls back to the default rather than breaking a screen. */
export function resolveElementsSettings(raw: unknown): ElementsSettings {
  const c = (raw && typeof raw === "object" ? raw : {}) as ContractElementsConfig;
  const codeMax = Number(c.code_max);
  const tol = Number(c.qty_tolerance_pct);
  const names = (c.level_names && typeof c.level_names === "object" ? c.level_names : {}) as Partial<LevelNames>;
  return {
    pattern: typeof c.pattern === "string" && c.pattern.trim() ? c.pattern.trim().slice(0, ELEMENT_LIMITS.patternMax) : DEFAULT_PATTERN,
    code_max: Number.isInteger(codeMax) && codeMax >= 6 && codeMax <= ELEMENT_LIMITS.codeMaxHard ? codeMax : ELEMENT_LIMITS.codeMaxDefault,
    qty_tolerance_pct: Number.isFinite(tol) && tol >= 0 && tol <= 100 ? tol : DEFAULT_TOLERANCE_PCT,
    level_names: {
      building: cleanName(names.building, DEFAULT_LEVEL_NAMES.building),
      activity: cleanName(names.activity, DEFAULT_LEVEL_NAMES.activity),
      cost_element: cleanName(names.cost_element, DEFAULT_LEVEL_NAMES.cost_element),
    },
  };
}

/** The element fields of a contract line, as the screens and routes carry them. All null on a line that is not an element. */
export type ElementFields = {
  element_type: string | null;
  element_code: string | null;
  client_qty: number | null;
  model_qty: number | null;
};

/** A column the code knows and the database does not have yet: migration 0253 or 0254 is pending. */
export const ELEMENTS_PENDING = "Buildings and elements need a database update (migration 0253)";
export const MODEL_PENDING = "The model comparison needs a database update (migration 0254)";
export const ELEMENTS_BUNDLE = "scripts/run-bundle-55-buildings-elements-0253-2026-11-24.sql";
export const MODEL_BUNDLE = "scripts/run-bundle-56-model-imports-0254-2026-11-24.sql";
