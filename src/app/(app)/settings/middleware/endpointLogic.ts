import {
  ENDPOINT_OBJECTS, methodsFor, normalisePath, parseEndpointInput, type Direction, type EndpointObject, type PublicEndpoint, type RunMode, type Schedule,
} from "@/lib/connections/endpointSpec";
import type { ConnectionFamily } from "@/lib/connections/spec";
import type { EndpointCandidate, EndpointDraft, EndpointTemplateView } from "./api";

// The pure parts of the Endpoints panel: the draft the manual form edits, what a picked metadata row or template row becomes,
// the line each row shows, and where "Open mapping" leads. Nothing here touches the network or the DOM.

export type Draft = {
  name: string; path: string; method: EndpointDraft["method"]; direction: Direction; object_type: EndpointObject | ""; run_mode: RunMode; schedule: Schedule;
};

export const emptyDraft = (): Draft => ({ name: "", path: "", method: undefined, direction: "in", object_type: "", run_mode: "manual", schedule: "daily" });

export const draftFromEndpoint = (e: PublicEndpoint): Draft => ({
  name: e.name, path: e.path, method: e.method, direction: e.direction, object_type: e.objectType, run_mode: e.runMode, schedule: e.schedule ?? "daily",
});

/** The request body of a hand-made endpoint. A method left unset follows the direction (GET reads, POST sends). */
export function toDraftBody(d: Draft, family: ConnectionFamily): EndpointDraft {
  const allowed = methodsFor(family, d.direction);
  const method = d.method && allowed.includes(d.method) ? d.method : allowed[0];
  return {
    name: d.name.trim(), path: d.path.trim(), direction: d.direction, object_type: (d.object_type || "customers") as EndpointObject, method,
    run_mode: d.run_mode, schedule: d.run_mode === "schedule" ? d.schedule : null, origin: "hand",
  };
}

/** The first reason a hand-made draft is refused, in the server's own words, or null. */
export function draftProblem(d: Draft, family: ConnectionFamily): string | null {
  if (!d.object_type) return "Choose the BPMSquare object it serves.";
  const r = parseEndpointInput({ ...toDraftBody(d, family) }, family);
  return r.ok ? null : r.errors[0].message;
}

/** A picked row of the system's description: reads (GET) come In, anything else goes Out. */
export function candidateToDraft(c: EndpointCandidate, object: EndpointObject, origin: "metadata" | "openapi", family: ConnectionFamily): EndpointDraft {
  const direction: Direction = c.method === "GET" ? "in" : "out";
  const label = c.name || c.path;
  return { name: label.slice(0, 80), path: normalisePath(family, c.path), direction, object_type: object, method: c.method, run_mode: "manual", origin };
}

export function templateToDrafts(t: EndpointTemplateView, picked: ReadonlySet<string>): EndpointDraft[] {
  return t.endpoints.filter((e) => picked.has(e.name)).map((e) => ({ ...e, run_mode: "manual" as const, origin: "template" as const, template_key: t.key }));
}

export const OBJECT_OPTIONS = ENDPOINT_OBJECTS;

/** Where "Open mapping" leads: the Mapping tab on this connection and object. */
export const mappingHref = (connectionId: string, object: EndpointObject): string =>
  `/settings/middleware?tab=mapping&connection=${encodeURIComponent(`conn:${connectionId}:${object}`)}`;

/** The connection-and-object choices the Mapping tab adds for endpoints: one per object, however many endpoints serve it. */
export function mappingChoices(connections: readonly { id: string; name: string }[], endpoints: Record<string, readonly Pick<PublicEndpoint, "objectType">[]>, objectLabel: Record<EndpointObject, string>): { key: string; label: string; document: EndpointObject; connection: string }[] {
  const out: { key: string; label: string; document: EndpointObject; connection: string }[] = [];
  for (const c of connections) {
    const seen = new Set<EndpointObject>();
    for (const e of endpoints[c.id] ?? []) {
      if (seen.has(e.objectType)) continue;
      seen.add(e.objectType);
      out.push({ key: `conn:${c.id}:${e.objectType}`, label: `${objectLabel[e.objectType]} ↔ ${c.name}`, document: e.objectType, connection: `conn:${c.id}` });
    }
  }
  return out;
}
