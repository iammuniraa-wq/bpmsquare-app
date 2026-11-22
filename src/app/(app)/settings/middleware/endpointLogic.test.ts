import { describe, expect, it } from "vitest";
import { OBJECT_LABEL } from "@/lib/connections/endpointSpec";
import type { PublicEndpoint } from "@/lib/connections/endpointSpec";
import { candidateToDraft, draftProblem, emptyDraft, mappingChoices, mappingHref, templateToDrafts, toDraftBody } from "./endpointLogic";

const ep = (objectType: PublicEndpoint["objectType"]) => ({ objectType });

describe("a hand-made endpoint", () => {
  it("needs a name, an operation and an object, and says which first", () => {
    const d = emptyDraft();
    expect(draftProblem(d, "odata")).toMatch(/object/i);
    d.object_type = "projects";
    expect(draftProblem(d, "odata")).toMatch(/name/i);
    d.name = "Projects";
    expect(draftProblem(d, "odata")).toMatch(/entity set/i);
    d.path = "ProjectsV2";
    expect(draftProblem(d, "odata")).toBeNull();
  });

  it("the method follows the direction: GET reads, POST sends, and a method that does not fit is replaced", () => {
    const d = { ...emptyDraft(), name: "x", path: "P", object_type: "projects" as const };
    expect(toDraftBody(d, "odata")).toMatchObject({ method: "GET", direction: "in", origin: "hand", run_mode: "manual", schedule: null });
    expect(toDraftBody({ ...d, direction: "out" }, "odata").method).toBe("POST");
    expect(toDraftBody({ ...d, direction: "out", method: "GET" }, "rest").method).toBe("POST");
    expect(toDraftBody({ ...d, direction: "out", method: "PATCH" }, "rest").method).toBe("PATCH");
  });

  it("a schedule is sent only when the endpoint runs on a schedule", () => {
    const d = { ...emptyDraft(), name: "x", path: "P", object_type: "projects" as const, schedule: "hourly" as const };
    expect(toDraftBody(d, "odata").schedule).toBeNull();
    expect(toDraftBody({ ...d, run_mode: "schedule" }, "odata").schedule).toBe("hourly");
  });
});

describe("picked rows", () => {
  it("a read from the system comes In, anything else goes Out, and the path is stored the way the type stores it", () => {
    expect(candidateToDraft({ name: "CustomersV3", path: "CustomersV3", method: "GET", summary: "", object_type: "customers" }, "customers", "metadata", "odata")).toMatchObject({ direction: "in", path: "CustomersV3", origin: "metadata" });
    expect(candidateToDraft({ name: "Create project", path: "projects", method: "POST", summary: "", object_type: null }, "projects", "openapi", "rest")).toMatchObject({ direction: "out", path: "/projects", method: "POST", origin: "openapi" });
  });

  it("template rows are only the ticked ones, stamped with the template", () => {
    const t = { key: "d365_fo", label: "x", family: "odata" as const, addressHint: "", endpoints: [
      { name: "Customers", path: "CustomersV3", method: "GET" as const, direction: "in" as const, object_type: "customers" as const },
      { name: "Projects", path: "Projects", method: "GET" as const, direction: "in" as const, object_type: "projects" as const },
    ] };
    expect(templateToDrafts(t, new Set(["Projects"]))).toEqual([{ name: "Projects", path: "Projects", method: "GET", direction: "in", object_type: "projects", run_mode: "manual", origin: "template", template_key: "d365_fo" }]);
    expect(templateToDrafts(t, new Set())).toEqual([]);
  });
});

describe("the Mapping tab's link to an endpoint", () => {
  it("opens the Mapping tab on the connection and the object", () => {
    expect(mappingHref("abc", "projects")).toBe("/settings/middleware?tab=mapping&connection=conn%3Aabc%3Aprojects");
  });

  it("one choice per connection and object, however many endpoints serve it; a connection without endpoints adds none", () => {
    const out = mappingChoices(
      [{ id: "a", name: "PCBS F&O" }, { id: "b", name: "Other" }],
      { a: [ep("projects"), ep("projects"), ep("customers")], b: [] },
      OBJECT_LABEL,
    );
    expect(out.map((c) => [c.key, c.label, c.document, c.connection])).toEqual([
      ["conn:a:projects", "Projects ↔ PCBS F&O", "projects", "conn:a"],
      ["conn:a:customers", "Customers ↔ PCBS F&O", "customers", "conn:a"],
    ]);
    expect(mappingChoices([], {}, OBJECT_LABEL)).toEqual([]);
  });
});
