import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));

import { listMessages } from "./monitor";
import { classifyIntegrationRow } from "./monitorRows";
import { fakeAdmin, T1 } from "./testHarness";

// Sales order messages in the Monitor (SO2): a refresh reads "Sales order <ERP number>", a pull reads "Sales orders",
// and a failed Sales orders run can be restarted like any other entity's.
const at = (min: number) => new Date(Date.UTC(2026, 9, 24, 10, min, 0)).toISOString();

describe("the Monitor on sales orders", () => {
  const db = () => fakeAdmin({
    integration_messages: [
      { id: "00000000-0000-4000-8000-000000000001", tenant_id: T1, direction: "in", channel: "webhook", connector_id: "dynamics365", entity: "sales_orders", object_type: "sales_orders", object_id: "so-1", ref_label: "Sales order ORD-01000", status: "ok", http_status: null, error: null, duration_ms: 420, correlation_id: null, summary: { headline: "Sales order ORD-01000: 1 invoice checked", trigger: "webhook" }, created_at: at(10) },
      { id: "00000000-0000-4000-8000-000000000002", tenant_id: T1, direction: "in", channel: "connector", connector_id: "dynamics365", entity: "sales_orders", object_type: null, object_id: null, ref_label: null, status: "failed", http_status: null, error: "boom", duration_ms: 900, correlation_id: null, summary: { kind: "connector_run", counts: { read: 3, created: 2, updated: 0, failed: 1 }, failed_rows: ["Sales order ORD-BAD: constraint"] }, created_at: at(5) },
    ],
  });

  it("names a refreshed order by its ERP number and the pull by its entity", async () => {
    const page = await listMessages(db().client, T1, {}, null, 20);
    const refresh = page.items.find((m) => m.record?.type === "sales_orders");
    expect(refresh).toMatchObject({ what: "Sales order ORD-01000", direction: "in", channel: "webhook", record: { type: "sales_orders", id: "so-1", label: "Sales order ORD-01000" } });
    expect(page.items.find((m) => m.record === null)).toMatchObject({ what: "Sales orders", status: "failed", restartable: true });
  });

  it("a failed Sales orders run is restartable; a refresh row is not", () => {
    expect(classifyIntegrationRow({ object_type: null, object_id: null, status: "failed", entity: "sales_orders", summary: { kind: "connector_run" } })).toBe("run");
    expect(classifyIntegrationRow({ object_type: "sales_orders", object_id: "so-1", status: "failed", entity: "sales_orders", summary: { headline: "x" } })).toBeNull();
  });
});
