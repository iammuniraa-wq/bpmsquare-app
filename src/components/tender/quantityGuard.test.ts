import { afterEach, describe, expect, it, vi } from "vitest";
import { quantityView } from "@/lib/tender/estimates/rules";
import { postReprice, unconfirmed } from "./quantityGuard";

// The confirmation before a build-up is priced: asked first when the screen knows, asked on the server's 409 when it did not, and
// never sent as confirmed unless the person said yes.

const view = quantityView({ status: "unknown", measured: null, boq_qty: 120, uom: "m2" }, false, "1.1 Floor tiles");
const calls: Record<string, unknown>[] = [];
const answer = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => json });

function fetchWith(...answers: ReturnType<typeof answer>[]) {
  calls.length = 0;
  const queue = [...answers];
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => { calls.push(JSON.parse(String(init.body))); return queue.shift()!; }));
}
afterEach(() => vi.unstubAllGlobals());

describe("postReprice", () => {
  it("asks before sending when the screen already knows, sends the confirmation only after a yes, and sends nothing after a no", async () => {
    fetchWith(answer(200, { repriced: [{}] }));
    const yes = vi.fn(async (_o: { title: string; body?: string; confirmLabel?: string }) => true);
    const out = await postReprice("/x", { link_ids: ["l1"] }, [view], yes);
    expect(yes).toHaveBeenCalledOnce();
    expect(yes.mock.calls[0][0]).toMatchObject({ title: "Is this estimate for 120 m2?", confirmLabel: "Yes, it is for 120 m2" });
    expect(out?.ok).toBe(true);
    expect(calls).toEqual([{ link_ids: ["l1"], confirm_quantity: true }]);

    fetchWith(answer(200, {}));
    expect(await postReprice("/x", { link_ids: ["l1"] }, [view], async () => false)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("sends a plain call when nothing needs confirming, without a confirmation flag", async () => {
    fetchWith(answer(200, { repriced: [] }));
    const never = vi.fn(async () => true);
    await postReprice("/x", { all_stale: true }, [], never);
    expect(never).not.toHaveBeenCalled();
    expect(calls).toEqual([{ all_stale: true }]);
  });

  it("when the server says 409 quantity_unconfirmed it asks, then repeats the call with the confirmation; a no ends it", async () => {
    fetchWith(answer(409, { code: "quantity_unconfirmed", error: view.note, lines: [view] }), answer(200, { repriced: [{}] }));
    const yes = vi.fn(async () => true);
    const out = await postReprice("/x", { all_stale: true }, [], yes);
    expect(yes).toHaveBeenCalledOnce();
    expect(out?.ok).toBe(true);
    expect(calls).toEqual([{ all_stale: true }, { all_stale: true, confirm_quantity: true }]);

    fetchWith(answer(409, { code: "quantity_unconfirmed", lines: [view] }), answer(200, {}));
    expect(await postReprice("/x", { all_stale: true }, [], async () => false)).toBeNull();
    expect(calls).toEqual([{ all_stale: true }]);
  });

  it("any other error is handed back untouched", async () => {
    fetchWith(answer(422, { error: "Nothing to re-price" }));
    const out = await postReprice("/x", { all_stale: true }, [], async () => true);
    expect(out).toMatchObject({ ok: false, status: 422, json: { error: "Nothing to re-price" } });
  });
});

describe("unconfirmed", () => {
  it("keeps only the lines that need a word", () => {
    expect(unconfirmed([view, null, undefined, { ...view, needs_confirm: false }])).toEqual([view]);
  });
});
