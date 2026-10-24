import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runIntake } from "./aiRun";
import type { ReadFile } from "./intakeFiles/convert";
import { CHAINLINK_FENCE_STARTER } from "./starterTemplates";

const A = "11111111-1111-4111-8111-111111111111";
const FENCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function fakeDb() {
  const row = { id: FENCE, tenant_id: A, name: CHAINLINK_FENCE_STARTER.name, inputs: CHAINLINK_FENCE_STARTER.inputs };
  const from = () => {
    const filters: [string, unknown][] = [];
    const q = {
      select() { return q; },
      eq(k: string, v: unknown) { filters.push([k, v]); return q; },
      maybeSingle() { return Promise.resolve({ data: filters.every(([k, v]) => (row as Record<string, unknown>)[k] === v) ? row : null, error: null }); },
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const EMAIL = "Hi, a chain link fence around our yard, see the attached plan. Regards, Omar";
const pdf: ReadFile = {
  id: "00000000-0000-4000-8000-000000000001", name: "plan.pdf", kind: "pdf", text: null, pages: 2, bytes: 1000,
  blocks: [{ type: "text", text: 'File "plan.pdf" (PDF, 2 pages) follows as a document.' }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: "AAAA" } }],
};

describe("reading the email with its files", () => {
  it("sends the files' blocks with the prompt, and returns file, page and a per-file report", async () => {
    const ask = vi.fn().mockResolvedValue({
      name: "Yard", sender: {}, assumptions: ["The email says 600 m but the plan says 450 m."],
      answers: [{ key: "total_length_m", status: "found", number: 450, choice: "", yes: false, source: "Total fence run 450 m", file: "plan.pdf", page: 2 }],
    });
    const r = await runIntake({
      supabase: fakeDb(), tenantId: A, templateId: FENCE, text: EMAIL, ask,
      files: { files: [pdf], skipped: [{ id: "00000000-0000-4000-8000-000000000002", name: "site.dxf", reason: "DXF files are read by the drawing reader." }] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [prompt, , extra] = ask.mock.calls[0];
    expect(prompt).toContain('"plan.pdf" (PDF)');
    expect(prompt).toContain("<email>");
    expect(extra).toEqual(pdf.blocks);
    expect(r.proposal.values.total_length_m).toBe(450);
    expect(r.proposal.fields!.total_length_m).toMatchObject({ status: "found", file: "plan.pdf", page: 2 });
    expect(r.proposal.assumptions.join(" ")).toContain("plan says 450 m");
    expect(r.proposal.assumptions.join(" ")).toContain("site.dxf was not read: DXF files are read by the drawing reader.");
    expect(r.proposal.files).toEqual([
      expect.objectContaining({ name: "plan.pdf", status: "read", kind: "pdf", pages: 2 }),
      expect.objectContaining({ name: "site.dxf", status: "skipped", note: expect.stringMatching(/drawing reader/) }),
    ]);
  });

  it("makes the same two-argument call as before when there are no files", async () => {
    const ask = vi.fn().mockResolvedValue({ name: "", sender: {}, assumptions: [], answers: [] });
    const r = await runIntake({ supabase: fakeDb(), tenantId: A, templateId: FENCE, text: EMAIL, ask });
    expect(r.ok).toBe(true);
    expect(ask.mock.calls[0]).toHaveLength(2);
    if (r.ok) expect(r.proposal.files).toBeUndefined();
  });

  it("still reads the email when every ticked file was skipped, and reports them", async () => {
    const ask = vi.fn().mockResolvedValue({ name: "", sender: {}, assumptions: [], answers: [] });
    const r = await runIntake({
      supabase: fakeDb(), tenantId: A, templateId: FENCE, text: EMAIL, ask,
      files: { files: [], skipped: [{ id: "00000000-0000-4000-8000-000000000003", name: "scan.pdf", reason: "The PDF is password protected." }] },
    });
    expect(ask.mock.calls[0]).toHaveLength(2);
    expect(r.ok && r.proposal.files).toEqual([expect.objectContaining({ name: "scan.pdf", status: "skipped" })]);
    expect(r.ok && r.proposal.assumptions.join(" ")).toContain("scan.pdf was not read");
  });

  it("does not touch another workspace's template", async () => {
    const ask = vi.fn();
    const r = await runIntake({ supabase: fakeDb(), tenantId: "22222222-2222-4222-8222-222222222222", templateId: FENCE, text: EMAIL, ask, files: { files: [pdf], skipped: [] } });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(ask).not.toHaveBeenCalled();
  });
});
