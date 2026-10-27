import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({}) }));

import { userContent } from "./structured";

describe("the user message of a structured call", () => {
  it("is the plain prompt string for a text-only call, as before", () => {
    expect(userContent({ prompt: "Read this." })).toBe("Read this.");
    expect(userContent({ prompt: "Read this.", extra: [] })).toBe("Read this.");
  });

  it("puts the extra blocks (documents, images, text) before the prompt", () => {
    const extra = [
      { type: "text" as const, text: "File plan.pdf follows." },
      { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: "AAAA" } },
    ];
    const c = userContent({ prompt: "Read this.", extra });
    expect(c).toEqual([...extra, { type: "text", text: "Read this." }]);
  });
});
