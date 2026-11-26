import { describe, expect, it } from "vitest";
import { dropConflictingColumns } from "./parse";

describe("a remembered BOQ layout is cleaned before it is shown", () => {
  it("keeps a column for one field only, the more important field first", () => {
    expect(dropConflictingColumns({ item_no: 1, description: 2, uom: 3, qty: 4, rate: 3, amount: 1 }, 5)).toEqual({ item_no: 1, description: 2, uom: 3, qty: 4 });
  });

  it("drops a field that points past the last column or at nothing", () => {
    expect(dropConflictingColumns({ description: 2, qty: 4, rate: 13, amount: 14, cost_code: 0 }, 5)).toEqual({ description: 2, qty: 4 });
  });

  it("leaves a clean layout alone", () => {
    const map = { item_no: 6, narration: 8, description: 9, uom: 10, qty: 11, rate: 12, amount: 13 };
    expect(dropConflictingColumns(map, 13)).toEqual(map);
  });
});
