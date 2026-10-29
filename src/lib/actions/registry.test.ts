import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ACTIONS, DEFERRED, DEFERRED_VERBS, actionByKey, actionFor, actionsEnabled, availableActions } from "./registry";
import { FIELD_REGISTRY } from "@/lib/fieldRegistry";
import { WORKCENTERS } from "@/lib/workcenters";
import { OBJECT_DEFS } from "@/lib/assistant/objects";
import { MODULE_LABEL } from "@/lib/capability/generate";
import type { PermissionSet } from "@/lib/permissions";

const API = path.resolve(__dirname, "../../app/api");
const hasPost = (file: string) => existsSync(file) && /export\s+async\s+function\s+POST\b/.test(readFileSync(file, "utf8"));

// The registry is the only list of what the assistant may write. These tests are what makes "a new object is wired
// on every surface" cover the assistant too: a new collection route with a POST that nobody decided about fails here.

describe("the action registry is complete", () => {
  it("every entry points at a real route with a POST, in a real module, workcenter and field registry", () => {
    const featureKeys = new Set(Object.keys(MODULE_LABEL));
    const objects = new Set(OBJECT_DEFS.map((d) => d.type as string));
    for (const a of ACTIONS) {
      expect(a.route.startsWith("/api/"), a.key).toBe(true);
      expect(hasPost(path.join(API, a.route.slice(5), "route.ts")), `${a.key}: POST in ${a.route}`).toBe(true);
      expect(featureKeys.has(a.featureKey), `${a.key}: feature`).toBe(true);
      expect(WORKCENTERS.some((w) => w.key === a.workcenter), `${a.key}: workcenter`).toBe(true);
      expect(FIELD_REGISTRY[a.registryType], `${a.key}: field registry`).toBeTruthy();
      expect(objects.has(a.base ?? a.object), `${a.key}: assistant object`).toBe(true);
      for (const f of a.alsoFeatures ?? []) expect(featureKeys.has(f), `${a.key}: also-feature ${f}`).toBe(true);
      for (const k of a.requiredKeys) {
        const isRef = a.refs.some((r) => r.key === k);
        const isExtra = (a.extraFields ?? []).some((f) => f.key === k);
        expect(isRef || isExtra || FIELD_REGISTRY[a.registryType].fields.some((f) => f.key === k), `${a.key}: required key ${k}`).toBe(true);
      }
      for (const k of a.fieldKeys ?? []) {
        expect(FIELD_REGISTRY[a.registryType].fields.some((f) => f.key === k), `${a.key}: offered key ${k}`).toBe(true);
      }
    }
  });

  it("an allow-listed entry never offers an internal or computed column", () => {
    for (const a of ACTIONS) {
      for (const k of a.fieldKeys ?? []) {
        const def = FIELD_REGISTRY[a.registryType].fields.find((f) => f.key === k)!;
        expect(def.editable !== false && !def.exportOnly, `${a.key}: ${k} is computed`).toBe(true);
        expect(["cost_price", "cost_price_as_of"], `${a.key}: ${k} is internal`).not.toContain(k);
      }
    }
  });

  it("keys and objects are unique, and the lookups find them", () => {
    expect(new Set(ACTIONS.map((a) => a.key)).size).toBe(ACTIONS.length);
    expect(new Set(ACTIONS.map((a) => a.object)).size).toBe(ACTIONS.length);
    for (const a of ACTIONS) { expect(actionByKey(a.key)).toBe(a); expect(actionFor(a.object)).toBe(a); }
    expect(ACTIONS.map((a) => a.object).sort()).toEqual(["account", "contact", "product", "supplier", "tender"]);
  });

  it("every collection route with a POST is either registered or deferred with a reason", () => {
    const registered = new Set(ACTIONS.map((a) => a.route.slice(5)));
    const found = readdirSync(API, { withFileTypes: true })
      .filter((d) => d.isDirectory() && hasPost(path.join(API, d.name, "route.ts")))
      .map((d) => d.name);
    const undecided = found.filter((n) => !registered.has(n) && !(n in DEFERRED));
    expect(undecided, "add each to ACTIONS (src/lib/actions/registry.ts) or DEFERRED with a reason").toEqual([]);
    const stale = Object.keys(DEFERRED).filter((n) => !found.includes(n));
    expect(stale, "DEFERRED entries whose route no longer has a POST").toEqual([]);
    // A nested route (the tender create under opportunities) is checked for its POST in the first test; its parent
    // collection route is a separate decision and stays in DEFERRED until a plain deal can be created too.
    for (const n of registered) if (!n.includes("/")) expect(found, `registered ${n}`).toContain(n);
    for (const [n, why] of Object.entries(DEFERRED)) expect(why.length, n).toBeGreaterThan(10);
  });

  it("what moved out of DEFERRED in this step is registered, and what stayed names its reason", () => {
    for (const n of ["suppliers", "products"]) expect(n in DEFERRED, n).toBe(false);
    expect(ACTIONS.some((a) => a.route === "/api/opportunities/tender")).toBe(true);
    expect(DEFERRED.opportunities).toMatch(/plain deal/);
    expect(DEFERRED.rfqs).toMatch(/lines/);
  });

  it("every deferred verb names a route that still exists with a POST, and a reason", () => {
    for (const [key, v] of Object.entries(DEFERRED_VERBS)) {
      expect(hasPost(path.join(API, v.route, "route.ts")), `${key}: POST in ${v.route}`).toBe(true);
      expect(v.why.length, key).toBeGreaterThan(10);
      expect(actionByKey(key), `${key} must not be registered and deferred`).toBeUndefined();
    }
  });

  it("the assistant has no update or delete action at all in this step", () => {
    for (const a of ACTIONS) expect(a.kind).toBe("create");
  });
});

describe("who may start an action", () => {
  const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
  const NO_CREATE: PermissionSet = {
    unrestricted: false,
    grants: new Map([["accounts", { workcenter: "accounts", canView: true, canCreate: false, canEdit: true, canDelete: false }]]),
  };
  const ON = { ai_assistant: true, ai_assistant_actions: true, next_experience: true, accounts: true, contacts: true };

  it("needs the flag, the assistant and Nova", () => {
    expect(actionsEnabled(ON)).toBe(true);
    expect(actionsEnabled({ ...ON, ai_assistant_actions: false })).toBe(false);
    expect(actionsEnabled({ ...ON, ai_assistant: false })).toBe(false);
    expect(actionsEnabled({ ...ON, next_experience: false })).toBe(false);
    expect(actionsEnabled({})).toBe(false);
  });

  it("offers an object only when its module is on and the role may create it", () => {
    expect(availableActions({ features: ON, perms: ALL }).map((a) => a.object)).toEqual(["account", "contact"]);
    expect(availableActions({ features: { ...ON, contacts: false }, perms: ALL }).map((a) => a.object)).toEqual(["account"]);
    expect(availableActions({ features: ON, perms: NO_CREATE })).toEqual([]);
    expect(availableActions({ features: { ...ON, ai_assistant_actions: false }, perms: ALL })).toEqual([]);
  });

  it("a tender deal needs the tender flag AND Pipeline; supplier and product each need their own module", () => {
    const MORE = { ...ON, suppliers: true, products: true, pipeline: true, gcc_tender: true };
    expect(availableActions({ features: MORE, perms: ALL }).map((a) => a.object)).toEqual(["account", "contact", "supplier", "product", "tender"]);
    expect(availableActions({ features: { ...MORE, gcc_tender: false }, perms: ALL }).map((a) => a.object)).not.toContain("tender");
    expect(availableActions({ features: { ...MORE, pipeline: false }, perms: ALL }).map((a) => a.object)).not.toContain("tender");
    expect(availableActions({ features: { ...MORE, suppliers: false }, perms: ALL }).map((a) => a.object)).not.toContain("supplier");
    expect(availableActions({ features: { ...MORE, products: false }, perms: ALL }).map((a) => a.object)).not.toContain("product");
    // The Business Role's create grant on the object's own workcenter decides it, as for an account.
    const pipelineOnly: PermissionSet = {
      unrestricted: false,
      grants: new Map([["pipeline", { workcenter: "pipeline", canView: true, canCreate: true, canEdit: false, canDelete: false }]]),
    };
    expect(availableActions({ features: MORE, perms: pipelineOnly }).map((a) => a.object)).toEqual(["tender"]);
  });
});
