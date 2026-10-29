import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: () => undefined }) }));

import { OBJECT_TYPES } from "./ChangeHistoryClient";

describe("the change-history filter", () => {
  it("lists People and access, the object type every login and access change is recorded under", () => {
    expect(OBJECT_TYPES).toContainEqual({ value: "tenant_users", label: "People and access" });
  });
});
