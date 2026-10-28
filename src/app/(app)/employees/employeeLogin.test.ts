import { describe, expect, it, vi } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/employees",
}));

import EmployeeLogin from "./EmployeeLogin";
import type { Employee } from "@/lib/types";

const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const employee = { id: "e1", first_name: "Asha", last_name: "Rao", email: "asha@acme.com", employee_code: "EMP-0001", valid_from: null, valid_to: null } as unknown as Employee;
const html = (login: { userId: string; status: "active" | "locked" | "expired" } | null) => renderToString(el(EmployeeLogin, { employee, login }));

describe("the employee record's login action", () => {
  it("offers Create business user while no login is linked, and no chip", () => {
    const out = html(null);
    expect(out).toContain("Create business user");
    expect(out).not.toContain("Open in People");
  });

  it("shows the login's state as a chip that opens that person in People, and no Create button", () => {
    const out = html({ userId: "u-1", status: "active" });
    expect(out).not.toContain("Create business user");
    expect(out).toContain('href="/settings/people?person=u-1"');
    expect(out).toContain("Active");
  });

  it("says Locked or Outside validity when the login cannot sign in", () => {
    expect(html({ userId: "u-1", status: "locked" })).toContain("Locked");
    expect(html({ userId: "u-1", status: "expired" })).toContain("Outside validity");
  });

  it("in a list row it says Create login, with no label, and shows the chip once a login exists", () => {
    const row = (login: { userId: string; status: "active" | "locked" | "expired" } | null) => renderToString(el(EmployeeLogin, { employee, login, compact: true }));
    expect(row(null)).toContain("Create login");
    expect(row(null)).not.toContain("Create business user");
    expect(row({ userId: "u-1", status: "active" })).toContain('href="/settings/people?person=u-1"');
    expect(row({ userId: "u-1", status: "active" })).not.toContain("Create login");
  });
});
