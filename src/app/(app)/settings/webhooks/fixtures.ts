import type { Webhook } from "./api";

// One shape for the tests: a Call webhook on accounts, with every optional part given a plain value.
export const hook = (over: Partial<Webhook> = {}): Webhook => ({
  id: "w1", kind: "call", name: "ERP push", url: "https://erp.acme.com/hooks/accounts", method: "POST", object_type: "accounts", object_types: [],
  headers: [{ name: "X-Api-Key", set: true }], payload_mode: "standard", template: null, allow_personal_data: false, timeout_ms: 15000,
  active: true, paused_reason: null, mapping_id: null, response_key_path: null, secret: "set", last_delivery_at: "2026-10-21T14:02:00", last_status: "200", last_error: null,
  failure_count: 0, needs_attention: null, used_by: [{ kind: "link", label: "Quote" }, { kind: "coverage", label: "EU team" }],
  created_at: "2026-10-01T10:00:00", updated_at: null, ...over,
});

export const eventHook = (over: Partial<Webhook> = {}): Webhook =>
  hook({ id: "w2", kind: "event", name: "Data warehouse", url: "https://hooks.dw.io/in", object_type: null, object_types: ["quotes"], used_by: [], ...over });
