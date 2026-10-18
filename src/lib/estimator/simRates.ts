// Template rate names the Simulation tab reads (docs/estimator-architecture.md
// §10, §14). Pure constants: shared by the validator, the schedule maths and
// the template editor, so the names live in one place.
//
// These are ordinary template rates (edited in the Rates tab). The formula
// engine does not need them, so the validator does not warn that they are
// unused. When a template does not define one, the default below is used and
// the Simulation tab says so.

export const SIM_CAPACITY_RATES = [
  { key: "cap_cast_m3_per_day", label: "Casting capacity", unit: "m³/day", default: 18, kind: "positive" },
  { key: "cap_trucks_loads_per_day", label: "Truck loads leaving the factory", unit: "loads/day", default: 4, kind: "positive" },
  { key: "cap_crane_m3_per_day", label: "Crane erection capacity", unit: "m³/day", default: 24, kind: "positive" },
  { key: "transport_start_day", label: "Transport starts on day", unit: "day", default: 5, kind: "day" },
  { key: "erection_start_day", label: "Erection starts on day", unit: "day", default: 6, kind: "day" },
] as const;

export type SimCapacityKey = (typeof SIM_CAPACITY_RATES)[number]["key"];

export const SIM_RATE_KEYS: ReadonlySet<string> = new Set(SIM_CAPACITY_RATES.map((r) => r.key));

/** Used for the number of truck loads when the estimate has no transport line. */
export const DEFAULT_LOAD_CAPACITY_T = 25;
/** The rate key that holds the tonnes one truck load carries. */
export const LOAD_CAPACITY_RATE_KEY = "transport_load_capacity_t";
