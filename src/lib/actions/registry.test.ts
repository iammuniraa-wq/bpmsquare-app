import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ACTIONS, DEFERRED, DEFERRED_VERBS, UPDATE_ACTIONS, VERB_ACTIONS, actionByKey, actionFor, actionsEnabled, availableActions, availableUpdates, availableVerbs,
  updateByKey, updateFor, verbByKey, verbFor,
} from "./registry";
import { FIELD_REGISTRY } from "@/lib/fieldRegistry";
import { WORKCENTERS } from "@/lib/workcenters";
import { OBJECT_DEFS } from "@/lib/assistant/objects";
import { MODULE_LABEL } from "@/lib/capability/generate";
import type { PermissionSet } from "@/lib/permissions";

const API = path.resolve(__dirname, "../../app/api");
const hasPost = (file: string) => existsSync(file) && /export\s+async\s+function\s+POST\b/.test(readFileSync(file, "utf8"));
const hasPatch = (file: string) => existsSync(file) && /export\s+async\s+function\s+PATCH\b/.test(readFileSync(file, "utf8"));
const routeFile = (route: string) => path.join(API, route.slice(5), "route.ts");

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
    // A tender step that posts to a collection route (an RFQ, an estimate) registers it too; one under a record does not.
    const registered = new Set([...ACTIONS.map((a) => a.route.slice(5)), ...VERB_ACTIONS.filter((v) => !v.route.includes("[")).map((v) => v.route.slice(5))]);
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
    // Step 4: an RFQ and an estimate are made from a tender deal (tender_rfq, tender_estimate), so their routes left DEFERRED.
    for (const n of ["rfqs", "estimates"]) expect(n in DEFERRED, n).toBe(false);
    expect(VERB_ACTIONS.map((v) => v.route)).toEqual(expect.arrayContaining(["/api/rfqs", "/api/estimates"]));
  });

  it("every deferred verb names a route that still exists with a POST, and a reason", () => {
    for (const [key, v] of Object.entries(DEFERRED_VERBS)) {
      expect(hasPost(path.join(API, v.route, "route.ts")), `${key}: POST in ${v.route}`).toBe(true);
      expect(v.why.length, key).toBeGreaterThan(10);
      expect(actionByKey(key), `${key} must not be registered and deferred`).toBeUndefined();
    }
  });

  it("creates, changes and tender steps are three separate lists, and nothing deletes", () => {
    for (const a of ACTIONS) expect(a.kind).toBe("create");
    for (const a of UPDATE_ACTIONS) expect(a.kind).toBe("update");
    for (const a of VERB_ACTIONS) expect(a.kind).toBe("verb");
    const keys = [...ACTIONS, ...UPDATE_ACTIONS, ...VERB_ACTIONS].map((a) => a.key);
    expect(new Set(keys).size, "one key space for the signed token").toBe(keys.length);
    expect(keys.some((k) => /delete/.test(k))).toBe(false);
  });
});

describe("change entries (kind update)", () => {
  const ROUTE_ALLOW = (file: string): string[] | null => {
    const m = /const allowed = \[([\s\S]*?)\];/.exec(readFileSync(file, "utf8"));
    return m ? [...m[1].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]) : null;
  };

  it("every entry points at a real PATCH, in a real module, workcenter and field registry, and mirrors the create entry's object", () => {
    const featureKeys = new Set(Object.keys(MODULE_LABEL));
    for (const u of UPDATE_ACTIONS) {
      expect(u.route, u.key).toContain("[id]");
      expect(hasPatch(routeFile(u.route)), `${u.key}: PATCH in ${u.route}`).toBe(true);
      expect(featureKeys.has(u.featureKey), `${u.key}: feature`).toBe(true);
      for (const f of u.alsoFeatures ?? []) expect(featureKeys.has(f), `${u.key}: also-feature ${f}`).toBe(true);
      expect(WORKCENTERS.some((w) => w.key === u.workcenter), `${u.key}: workcenter`).toBe(true);
      expect(FIELD_REGISTRY[u.registryType], `${u.key}: field registry`).toBeTruthy();
      const create = actionFor(u.object);
      expect(create, `${u.key}: a create entry with the same object word`).toBeTruthy();
      expect([create!.featureKey, create!.workcenter, create!.registryType, create!.table], u.key).toEqual([u.featureKey, u.workcenter, u.registryType, u.table]);
    }
    expect(UPDATE_ACTIONS.map((u) => u.object).sort()).toEqual(["account", "contact", "product", "supplier", "tender"]);
    for (const u of UPDATE_ACTIONS) { expect(updateByKey(u.key)).toBe(u); expect(updateFor(u.object)).toBe(u); }
  });

  it("every field it may set is a plain editable field the route's own allow-list takes; never a status, a stage, an owner, a total or a cost", () => {
    const NEVER = ["cost_price", "cost_price_as_of", "stage", "outcome", "loss_reason", "loss_note", "amount", "probability", "owner_id", "team", "ref", "id", "tenant_id", "account_id", "referred_by_account_id", "supplier_id", "item_type", "custom_data", "total", "subtotal"];
    for (const u of UPDATE_ACTIONS) {
      const file = routeFile(u.route.replace("[id]", "[id]"));
      const allow = ROUTE_ALLOW(file);
      const source = readFileSync(file, "utf8");
      for (const k of u.fieldKeys) {
        const def = FIELD_REGISTRY[u.registryType].fields.find((f) => f.key === k);
        expect(def, `${u.key}: ${k} in the field registry`).toBeTruthy();
        expect(def!.editable !== false && !def!.exportOnly, `${u.key}: ${k} is computed`).toBe(true);
        expect(NEVER, `${u.key}: ${k} is not changeable from a chat`).not.toContain(k);
        if (allow) expect(allow, `${u.key}: ${k} on the PATCH allow-list`).toContain(k);
        else expect(source, `${u.key}: ${k} handled by the PATCH`).toContain(`"${k}"`);
      }
      expect(u.fieldKeys.length, u.key).toBeGreaterThan(0);
    }
    // Product status is a plain choice; the margin (cost) side is never offered.
    expect(updateFor("product")!.fieldKeys).not.toContain("cost_price");
    expect(updateFor("tender")!.tenderOnly).toBe(true);
  });
});

describe("tender step entries (kind verb)", () => {
  it("every entry posts to a real route with a POST, in a real module and workcenter", () => {
    const featureKeys = new Set(Object.keys(MODULE_LABEL));
    for (const v of VERB_ACTIONS) {
      expect(hasPost(routeFile(v.route)), `${v.key}: POST in ${v.route}`).toBe(true);
      expect(featureKeys.has(v.featureKey), `${v.key}: feature`).toBe(true);
      for (const f of v.alsoFeatures) expect(featureKeys.has(f), `${v.key}: also-feature ${f}`).toBe(true);
      expect(WORKCENTERS.some((w) => w.key === v.workcenter), `${v.key}: workcenter`).toBe(true);
      for (const g of v.alsoGrants ?? []) expect(WORKCENTERS.some((w) => w.key === g.workcenter), `${v.key}: grant ${g.workcenter}`).toBe(true);
      expect(v.primaryLabel.length, v.key).toBeGreaterThan(3);
      expect(verbByKey(v.key)).toBe(v);
      expect(verbFor(v.verb)).toBe(v);
    }
    expect(VERB_ACTIONS.map((v) => v.verb).sort()).toEqual(["decision", "estimate", "match", "price", "rfq", "submit_bid"]);
  });

  it("the tender steps all need the tender edition and Pipeline", () => {
    for (const v of VERB_ACTIONS) { expect(v.featureKey, v.key).toBe("gcc_tender"); expect(v.alsoFeatures, v.key).toContain("pipeline"); }
  });
});

describe("who may start an action", () => {
  const editOnly = (...wcs: ("accounts" | "contacts" | "pipeline" | "rfqs" | "estimates" | "suppliers" | "products")[]): PermissionSet => ({
    unrestricted: false,
    grants: new Map(wcs.map((w) => [w, { workcenter: w, canView: true, canCreate: false, canEdit: true, canDelete: false }])),
  });
  const TENDER = { ai_assistant: true, ai_assistant_actions: true, accounts: true, contacts: true, suppliers: true, products: true, pipeline: true, gcc_tender: true, rfq: true, estimator: true };

  it("a change needs the module and the Business Role's EDIT grant (a create grant alone is not enough)", () => {
    expect(availableUpdates({ features: TENDER, perms: ALL }).map((u) => u.object)).toEqual(["account", "contact", "supplier", "product", "tender"]);
    expect(availableUpdates({ features: TENDER, perms: NO_CREATE }).map((u) => u.object)).toEqual(["account"]);
    expect(availableUpdates({ features: TENDER, perms: editOnly("contacts", "pipeline") }).map((u) => u.object)).toEqual(["contact", "tender"]);
    expect(availableUpdates({ features: { ...TENDER, contacts: false }, perms: ALL }).map((u) => u.object)).not.toContain("contact");
    expect(availableUpdates({ features: { ...TENDER, gcc_tender: false }, perms: ALL }).map((u) => u.object)).not.toContain("tender");
    expect(availableUpdates({ features: { ...TENDER, ai_assistant_actions: false }, perms: ALL })).toEqual([]);
    expect(availableUpdates({ features: { ...TENDER, ai_assistant: false }, perms: ALL })).toEqual([]);
  });

  it("changes and tender steps work with Nova off and are absent with the actions flag off", () => {
    expect(TENDER).not.toHaveProperty("next_experience");
    expect(availableUpdates({ features: TENDER, perms: ALL }).length).toBeGreaterThan(0);
    expect(availableVerbs({ features: TENDER, perms: ALL }).length).toBe(6);
    expect(availableVerbs({ features: { ...TENDER, ai_assistant_actions: false }, perms: ALL })).toEqual([]);
  });

  it("a tender step needs its modules and the Pipeline edit grant, plus the RFQ or Estimates grant for those two", () => {
    expect(availableVerbs({ features: TENDER, perms: ALL }).map((v) => v.verb)).toEqual(["decision", "submit_bid", "rfq", "estimate", "match", "price"]);
    expect(availableVerbs({ features: TENDER, perms: NO_CREATE })).toEqual([]);
    expect(availableVerbs({ features: TENDER, perms: editOnly("pipeline") }).map((v) => v.verb)).toEqual(["decision", "submit_bid", "match", "price"]);
    expect(availableVerbs({ features: TENDER, perms: editOnly("pipeline", "rfqs") }).map((v) => v.verb)).toContain("rfq");
    expect(availableVerbs({ features: { ...TENDER, rfq: false }, perms: ALL }).map((v) => v.verb)).not.toContain("rfq");
    expect(availableVerbs({ features: { ...TENDER, suppliers: false }, perms: ALL }).map((v) => v.verb)).not.toContain("rfq");
    expect(availableVerbs({ features: { ...TENDER, estimator: false }, perms: ALL }).map((v) => v.verb)).not.toContain("estimate");
    expect(availableVerbs({ features: { ...TENDER, products: false }, perms: ALL }).map((v) => v.verb)).not.toContain("match");
    expect(availableVerbs({ features: { ...TENDER, gcc_tender: false }, perms: ALL })).toEqual([]);
  });

  const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
  const NO_CREATE: PermissionSet = {
    unrestricted: false,
    grants: new Map([["accounts", { workcenter: "accounts", canView: true, canCreate: false, canEdit: true, canDelete: false }]]),
  };
  const ON = { ai_assistant: true, ai_assistant_actions: true, next_experience: true, accounts: true, contacts: true };

  it("needs the flag and the assistant, and not Nova", () => {
    expect(actionsEnabled(ON)).toBe(true);
    expect(actionsEnabled({ ...ON, ai_assistant_actions: false })).toBe(false);
    expect(actionsEnabled({ ...ON, ai_assistant: false })).toBe(false);
    expect(actionsEnabled({ ...ON, next_experience: false })).toBe(true);
    expect(actionsEnabled({ ai_assistant: true, ai_assistant_actions: true })).toBe(true);
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
