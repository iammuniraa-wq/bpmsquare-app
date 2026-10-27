import { describe, expect, it } from "vitest";
import { buildCsv, byLabel, csvRow, viaLabel, CSV_HEADER, type ChangeLogRow } from "./changeHistoryRows";

const row = (over: Partial<ChangeLogRow> = {}): ChangeLogRow => ({
  id: "c1", object_type: "accounts", object_id: "a1", object_label: "Acme", action: "create", changes: [],
  actor_id: "u1", actor_email: "u@x.com", created_at: "2026-10-22T10:00:00Z", ...over,
});

describe("change history: the By name", () => {
  it("shows the person's name, never the login address", () => {
    expect(byLabel({ actor_name: " Asha Rao ", actor_email: "emp-asha.136f@x.com" })).toBe("Asha Rao");
    expect(byLabel({ actor_name: null, actor_email: "ravi@x.com" })).toBe("ravi");
    expect(byLabel({})).toBe("—");
  });
  it("puts the name in the CSV's Changed by column", () => {
    const at = CSV_HEADER.indexOf("Changed by");
    expect(csvRow(row({ actor_name: "Asha Rao" })).split(",")[at]).toBe("Asha Rao");
  });
});

describe("change history: the 'via' mark", () => {
  it("labels a change the assistant made, and nothing else", () => {
    expect(viaLabel("assistant")).toBe("via assistant");
    for (const none of [null, undefined, "", "  ", 3]) expect(viaLabel(none)).toBeNull();
  });
  it("puts the surface in its own CSV column, empty for ordinary changes and for rows from before the column", () => {
    expect(CSV_HEADER).toContain("Via");
    const cols = (r: ChangeLogRow) => csvRow(r).split(",");
    const at = CSV_HEADER.indexOf("Via");
    expect(cols(row({ via: "assistant" }))[at]).toBe("assistant");
    expect(cols(row({ via: null }))[at]).toBe("");
    expect(cols(row())[at]).toBe("");
    expect(cols(row({ via: "assistant" })).length).toBe(CSV_HEADER.length);
  });
  it("keeps the BOM and line endings of the old export", () => {
    const csv = buildCsv([row({ via: "assistant" })]);
    expect(csv.startsWith("﻿Date,Action,")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });
});
