import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/link", () => ({
  default: (p: { href: string; className?: string; children: unknown; "data-guide"?: string }) =>
    createElement("a", { href: p.href, className: p.className, "data-guide": p["data-guide"] }, p.children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));
const css = vi.hoisted(() => ({ default: new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) }) }));
vi.mock("@/components/inbox/inbox.module.css", () => css);
vi.mock("@/components/ui/SidePanel.module.css", () => css);

import ThreadClient from "./ThreadClient";
import CreateFromEmail from "./CreateFromEmail";
import { QualityTag, StatusTag, senderName, sizeWord, whenWord } from "./bits";
import type { InboxChannel, InboxDetailView, InboxEmail } from "@/lib/inbox/types";

// Closed-state markup, rendered with real props and no browser. What matters here is that a customer's words are only
// ever drawn as text: whatever a message contains, the page holds it as escaped characters inside a pre-wrapped block.

const HOSTILE = '<script>alert("x")</script><img src=x onerror=alert(1)> & "quotes" <a href="https://evil.test">click</a>';
const channel: InboxChannel = {
  id: "ch1", tenant_id: "t1", name: "Fence enquiries", address_alias: "inbox-aaaaaaaaaaaaaaaa", connector_id: null, role_ids: [], default_action: "quote",
  default_template_id: null, reply_from: null, reply_name: null, active: true,
};
const mailRow = (over: Partial<InboxEmail> = {}): InboxEmail => ({
  id: "e1", tenant_id: "t1", channel_id: "ch1", direction: "in", from_address: "sara@customer.test", from_name: "Sara Khan", to_addresses: ["x@in.test"],
  subject: "Fence for 300 m", snippet: null, body_text: "Please quote 300 m.\n\nOn Mon, 3 Oct 2026, Sales wrote:\n> earlier text", message_id: "m1", thread_key: "m:m1",
  received_at: "2026-10-24T08:00:00Z", status: "new", assigned_to: null, linked_object_type: null, linked_object_id: null, linked_object_label: null,
  converted_at: null, expires_at: "2027-01-22T00:00:00Z", purged_at: null, read_at: null, handled_at: null, send_status: null, error: null, created_by: null, ...over,
});
const detail = (over: Partial<InboxDetailView> = {}): InboxDetailView => ({
  email: mailRow(), channel, thread: [mailRow()], attachments: [], sender: { name: "Sara Khan", address: "sara@customer.test", suggestedName: "Sara Khan", match: null },
  createOptions: [
    { type: "quote", available: true, reason: null }, { type: "project", available: true, reason: null }, { type: "case", available: true, reason: null },
    { type: "estimate", available: false, reason: "Estimates not available" }, { type: "lead", available: true, reason: null },
  ],
  members: [{ user_id: "u1", name: "Aisha", email: "aisha@gulf.test" }], needsBetterDrawing: false, estimatesAvailable: false, ...over,
});
const view = (d: InboxDetailView, canEdit = true) =>
  renderToString(createElement(ThreadClient, { detail: d, canEdit, companyName: "Gulf Fence", linkFeatures: {}, retentionDays: 88, nowIso: "2026-10-24T09:00:00Z" }));

describe("a customer's words are only ever text", () => {
  it("escapes markup in the sender, the subject-bearing thread and the body", () => {
    const d = detail({
      email: mailRow({ from_name: HOSTILE, body_text: HOSTILE }),
      thread: [mailRow({ from_name: HOSTILE, body_text: HOSTILE })],
      attachments: [{ id: "a1", email_id: "e1", file_name: '"><script>x</script>.pdf', mime_type: "application/pdf", ext: "pdf", size_bytes: 40_000, quality: "good", quality_note: null, summary: null }],
    });
    const out = view(d);
    expect(out).not.toMatch(/<script>alert|<img src=x|href="https:\/\/evil\.test"|<a href="https:\/\/evil/);
    expect(out).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(out).toContain("&lt;script&gt;x&lt;/script&gt;.pdf");
  });

  it("shows the fresh text and keeps the quoted history folded away", () => {
    const out = view(detail());
    expect(out).toContain("Please quote 300 m.");
    expect(out).toMatch(/<details class="quoted"><summary>Earlier text<\/summary>/);
    expect(out).toContain("&gt; earlier text");
  });

  it("a cleared message says so, with no text", () => {
    const out = view(detail({ email: mailRow({ body_text: null, purged_at: "2027-01-01T00:00:00Z" }), thread: [mailRow({ body_text: null, purged_at: "2027-01-01T00:00:00Z" })] }));
    expect(out).toContain("The text was cleared after its retention period.");
    expect(out).not.toContain("Please quote");
  });
});

describe("the message screen", () => {
  it("labels each file by quality and offers Ask for PDF or DXF, primary when no file is good", () => {
    const poor = detail({
      attachments: [{ id: "a1", email_id: "e1", file_name: "plot.dwg", mime_type: "image/vnd.dwg", ext: "dwg", size_bytes: 1_400_000, quality: "poor", quality_note: "A DWG cannot be read here. Ask the customer to save a DXF or PDF.", summary: null }],
      needsBetterDrawing: true,
    });
    const out = view(poor);
    expect(out).toContain("plot.dwg");
    expect(out).toContain(">Poor<");
    expect(out).toContain("1.3 MB");
    expect(out).toContain("None of the files can be measured from with confidence. Ask for a PDF or DXF.");
    expect(out).toContain('data-guide="inbox.ask_drawing"');
    expect(out).toMatch(/bpm-btn-primary[^>]*data-guide="inbox\.ask_drawing"|data-guide="inbox\.ask_drawing"[^>]*bpm-btn-primary/);
  });

  it("offers the actions to someone who can edit, and only the facts to someone who cannot", () => {
    const edit = view(detail());
    for (const id of ["inbox.handled", "inbox.spam", "inbox.create", "inbox.assign", "inbox.reply", "inbox.send", "inbox.back", "inbox.file"]) {
      if (id === "inbox.file") continue;
      expect(edit, id).toContain(`data-guide="${id}"`);
    }
    const read = view(detail(), false);
    for (const id of ["inbox.handled", "inbox.spam", "inbox.create", "inbox.reply", "inbox.send"]) expect(read, id).not.toContain(`data-guide="${id}"`);
    expect(read).toContain("Nobody");
  });

  it("a message that became a record links to it and cannot be converted again", () => {
    const linked = detail({ email: mailRow({ status: "handled", linked_object_type: "standard_quotes", linked_object_id: "q1", linked_object_label: "SQ-0001" }) });
    const out = view(linked);
    expect(out).toContain('href="/standard-quotes/q1"');
    expect(out).toContain("This email became");
    expect(out).toMatch(/data-guide="inbox\.create"[^>]*disabled|disabled[^>]*data-guide="inbox\.create"/);
  });

  it("shows earlier messages behind a button after three, and our replies as such", () => {
    const thread = [1, 2, 3, 4, 5].map((i) => mailRow({ id: `e${i}`, body_text: `message ${i}`, direction: i === 5 ? "out" : "in", send_status: i === 5 ? "failed" : null }));
    const out = view(detail({ thread }));
    expect(out).toContain("Show 2 earlier messages");
    expect(out).not.toContain("message 1");
    expect(out).toContain("message 5");
    expect(out).toContain("Gulf Fence (reply)");
    expect(out).toContain("not sent");
  });

  it("a paused channel shows no reply box", () => {
    expect(view(detail({ channel: { ...channel, active: false } }))).not.toContain('data-guide="inbox.reply"');
  });
});

describe("Create from this email", () => {
  const bits = { id: "e1", subject: "Fence", from_name: "Sara", from_address: "sara@customer.test", body_text: "hi" };
  it("is one primary button; the menu opens on click", () => {
    const out = renderToString(createElement(CreateFromEmail, { email: bits, options: detail().createOptions, match: null, suggestedAccount: "Sara Khan", estimatesAvailable: false, disabled: false }));
    expect(out).toContain("Create from this email ▾");
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('role="menu"');
  });
});

describe("small pieces", () => {
  it("quality and status chips, names, sizes and times", () => {
    expect(renderToString(createElement(QualityTag, { quality: "review" }))).toContain("Needs review");
    expect(renderToString(createElement(StatusTag, { status: "spam" }))).toContain("Spam");
    expect(senderName({ from_name: null, from_address: null })).toBe("Unknown sender");
    expect(sizeWord(2_500)).toBe("2 KB");
    const now = new Date("2026-10-24T12:00:00Z");
    expect(whenWord("2026-10-24T11:58:00Z", now)).toBe("2 min ago");
    expect(whenWord("2026-10-24T09:00:00Z", now)).toBe("3 h ago");
    expect(whenWord("nonsense", now)).toBe("");
  });
});
