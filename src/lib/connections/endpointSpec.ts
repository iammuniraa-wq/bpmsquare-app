import { hasCredentialParam } from "@/lib/net/credentialParam";
import type { ConnectionFamily, FieldError } from "./spec";

// An endpoint is one thing a connection offers BPMSquare: a name, the operation (a method and path for REST, an entity set for
// OData), a direction, the BPMSquare object it serves, and how it runs. A connection starts with NONE. Client-safe.
// The objects are the documents the mapping engine already knows (src/lib/middleware/mappingDoc.ts), so an endpoint's mapping is
// the existing Mapping tab, keyed by the connection `conn:<id>` and the object.

export const ENDPOINT_OBJECTS = ["quote", "customers", "contacts", "products", "projects"] as const;
export type EndpointObject = (typeof ENDPOINT_OBJECTS)[number];
export const OBJECT_LABEL: Record<EndpointObject, string> = { quote: "Quote", customers: "Customers", contacts: "Contacts", products: "Products", projects: "Projects" };

export const DIRECTIONS = ["in", "out"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const DIRECTION_LABEL: Record<Direction, string> = { in: "In: read from the system", out: "Out: send to the system" };

export const RUN_MODES = ["manual", "schedule", "on_change"] as const;
export type RunMode = (typeof RUN_MODES)[number];
export const RUN_MODE_LABEL: Record<RunMode, string> = { manual: "Manual", schedule: "Schedule", on_change: "On change" };

export const SCHEDULES = ["hourly", "daily"] as const;
export type Schedule = (typeof SCHEDULES)[number];

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];

export const ORIGINS = ["hand", "metadata", "openapi", "template"] as const;
export type Origin = (typeof ORIGINS)[number];

export const MAX_BATCH = 50;

export type EndpointInput = {
  name?: unknown; method?: unknown; path?: unknown; direction?: unknown; object_type?: unknown;
  run_mode?: unknown; schedule?: unknown; enabled?: unknown; origin?: unknown; template_key?: unknown;
};

export type ParsedEndpoint = {
  name: string; method: Method; path: string; direction: Direction; object_type: EndpointObject;
  run_mode: RunMode; schedule: Schedule | null; enabled: boolean; origin: Origin; template_key: string | null;
};

export type PublicEndpoint = {
  id: string; connectionId: string; name: string; method: Method; path: string; direction: Direction; objectType: EndpointObject;
  runMode: RunMode; schedule: Schedule | null; enabled: boolean; origin: Origin; templateKey: string | null;
  lastRunAt: string | null; lastRunStatus: "ok" | "failed" | null; lastRunMessage: string | null;
};

const SET_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,99}$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (list as readonly string[]).includes(String(v)) ? (v as T) : null;

/** Which request methods make sense for a direction on a connection type. */
export function methodsFor(family: ConnectionFamily, direction: Direction): Method[] {
  if (family === "odata") return direction === "in" ? ["GET"] : ["POST", "PATCH"];
  return direction === "in" ? ["GET", "POST"] : ["POST", "PUT", "PATCH", "DELETE"];
}

/** The path or entity set as it is stored: REST starts with one slash, OData is the bare entity set name. */
export function normalisePath(family: ConnectionFamily, raw: string): string {
  const t = raw.trim();
  if (family === "odata") return t.replace(/^\/+/, "");
  return t ? `/${t.replace(/^\/+/, "")}` : "";
}

export function parseEndpointInput(input: EndpointInput, family: ConnectionFamily): { ok: true; value: ParsedEndpoint } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const err = (field: string, message: string) => errors.push({ field, message });

  const name = str(input.name, 80);
  if (!name) err("name", "Give the endpoint a name.");

  const direction = oneOf(DIRECTIONS, input.direction);
  if (!direction) err("direction", "Choose In or Out.");

  const object = oneOf(ENDPOINT_OBJECTS, input.object_type);
  if (!object) err("object_type", "Choose the BPMSquare object it serves.");

  const rawPath = str(input.path, 300);
  const path = normalisePath(family, rawPath);
  if (family === "rest" && (/^\/\//.test(rawPath) || /^[a-z][a-z0-9+.-]*:/i.test(rawPath))) err("path", "The path must stay on the connection's server and start with a single /, such as /projects.");
  else if (!path) err("path", family === "odata" ? "Enter the entity set, such as ProjectsV2." : "Enter the path, such as /projects.");
  else if (family === "odata") {
    if (!SET_NAME.test(path)) err("path", "An entity set is a name such as ProjectsV2, with no slashes or spaces.");
  } else if (/^\/\//.test(path) || /[\s\\]|\.\./.test(path) || path.length > 300) {
    err("path", "The path must stay on the connection's server and have no spaces, such as /projects.");
  } else if (hasCredentialParam(path)) {
    err("path", "Do not put a key or token in the path. Keep it in the connection's sign-in.");
  }

  const method = input.method === undefined || input.method === "" ? (direction === "out" ? "POST" : "GET") : oneOf(METHODS, input.method);
  if (!method) err("method", "Choose a request method.");
  else if (direction && !methodsFor(family, direction).includes(method)) {
    err("method", direction === "in" ? "An endpoint that reads uses GET." : "An endpoint that sends uses POST, PUT, PATCH or DELETE.");
  }

  const runMode = input.run_mode === undefined || input.run_mode === "" ? "manual" : oneOf(RUN_MODES, input.run_mode);
  if (!runMode) err("run_mode", "Choose Manual, Schedule or On change.");
  let schedule: Schedule | null = null;
  if (runMode === "schedule") {
    schedule = oneOf(SCHEDULES, input.schedule);
    if (!schedule) err("schedule", "Choose hourly or daily.");
  }
  if (runMode === "on_change" && direction === "in") err("run_mode", "On change is for endpoints that send. An endpoint that reads runs manually or on a schedule.");

  const origin = input.origin === undefined || input.origin === "" ? "hand" : oneOf(ORIGINS, input.origin);
  if (!origin) err("origin", "Unknown origin.");

  if (errors.length || !direction || !object || !method || !runMode || !origin) return { ok: false, errors };
  const tpl = str(input.template_key, 60);
  return { ok: true, value: { name, method, path, direction, object_type: object, run_mode: runMode, schedule, enabled: input.enabled === true, origin, template_key: tpl || null } };
}

/** "GET /projects" or "ProjectsV2": the operation as one short line. */
export const operationLine = (family: ConnectionFamily, e: Pick<PublicEndpoint, "method" | "path" | "direction">): string =>
  family === "odata" ? `${e.path}${e.method === "GET" ? "" : ` (${e.method})`}` : `${e.method} ${e.path}`;

export const runLine = (e: Pick<PublicEndpoint, "runMode" | "schedule">): string =>
  e.runMode === "schedule" ? `Schedule: ${e.schedule ?? "daily"}` : RUN_MODE_LABEL[e.runMode];

/** The BPMSquare object a metadata name most likely serves, or null (the person chooses). */
export function guessObject(name: string): EndpointObject | null {
  const n = name.toLowerCase();
  if (/quot/.test(n)) return "quote";
  if (/contact/.test(n)) return "contacts";
  if (/project/.test(n)) return "projects";
  if (/customer|account|partner/.test(n)) return "customers";
  if (/product|item|material/.test(n)) return "products";
  return null;
}
