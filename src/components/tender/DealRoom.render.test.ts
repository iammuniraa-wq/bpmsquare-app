import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RoomMessageView, RoomPayload } from "@/lib/tender/room";

// The Deal Room as four sub-tabs in one column (owner, 2026-10-29): Discussion, Team, Decisions, Documents. Questions are no longer
// started here, and the room stays internal. Rendered on the server from an already loaded room; 375 px and PC share one markup
// (one column, the tab strip scrolls sideways), so the checks are the ones that decide whether a phone fits.

const url = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(url.query),
  usePathname: () => "/pipeline/x",
}));

import DealRoom from "./DealRoom";

const clean = (h: string) => h.replace(/<!-- -->/g, "");
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const payload: RoomPayload = {
  room: { id: "r1", created_at: "2026-10-20T08:00:00Z" },
  members: [
    { user_id: "u1", name: "S. Khan", email: "s@k.test", last_seen_at: null, is_you: true },
    { user_id: "u2", name: "A. Nasser", email: "a@k.test", last_seen_at: null, is_you: false },
  ],
  candidates: [{ user_id: "u3", name: "M. Omar" }],
  you_are_member: true, unread: 0, open_questions: 0, now: "2026-10-29T08:00:00Z",
};

const msg = (id: string, over: Partial<RoomMessageView> = {}): RoomMessageView => ({
  id, kind: "message", body: `body ${id}`, removed: false, parent_id: null, author_id: "u2", author_name: "A. Nasser",
  created_at: "2026-10-28T08:00:00Z", updated_at: "2026-10-28T08:00:00Z", mentions: [], question: null, files: [], ...over,
});

const messages: RoomMessageView[] = [
  msg("m1", { body: "Who has the datasheet?", kind: "question", question: { owner_id: null, owner_name: null, due: null, status: "open", answered_at: null } }),
  msg("m2", { body: "Use the supplier quote" }),
  msg("m3", { kind: "decision", body: "Bid with alternative cladding" }),
  msg("m4", { body: "See attached", files: [{ id: "f1", name: "spec.pdf", size: 2048, mime: "application/pdf" }] }),
];

const room = (query = "") => {
  url.query = query;
  return clean(renderToString(createElement(DealRoom, { opportunityId: OPP, currentUserId: "u1", isAdmin: false, initialState: { payload, messages } } as never)));
};

describe("the Deal Room sub-tabs", () => {
  it("has Discussion, Team, Decisions and Documents, Discussion first and open by default", () => {
    const out = room();
    const labels = [...out.matchAll(/role="tab"[^>]*>([^<]*)/g)].map((m) => m[1].replace(/\d+$/, ""));
    expect(labels).toEqual(["Discussion", "Team", "Decisions", "Documents"]);
    for (const id of ["discussion", "team", "decisions", "documents"]) expect(out).toContain(`data-guide="tab:${id}"`);
    expect(out).toContain('data-guide="room.subtabs"');
    expect(out).toContain('data-guide="room.discussion"');
    expect(out).toContain("Use the supplier quote");
  });

  it("?room=team opens Team: members and Add by name, not the thread", () => {
    const out = room("room=team");
    expect(out).toContain('data-guide="room.members"');
    expect(out).toContain("S. Khan (you)");
    expect(out).toContain("Add by name");
    expect(out).toContain("M. Omar");
    expect(out).not.toContain('data-guide="room.composer"');
  });

  it("?room=decisions shows the pinned decisions and the pin box; ?room=documents lists the files", () => {
    const d = room("room=decisions");
    expect(d).toContain("Bid with alternative cladding");
    expect(d).toContain('data-guide="room.decision_input"');
    expect(d).not.toContain("Use the supplier quote");
    const f = room("room=documents");
    expect(f).toContain('data-guide="room.files"');
    expect(f).toContain("spec.pdf");
  });

  it("the tabs carry counts for decisions and files, and an unknown value falls back to Discussion", () => {
    const out = room("room=nonsense");
    expect(out).toContain('data-guide="room.discussion"');
    expect(out).toMatch(/Decisions<span class="bpm-tab-count">1</);
    expect(out).toMatch(/Documents<span class="bpm-tab-count">1</);
  });

  it("starts no questions: no Question checkbox, owner or due field, no open-questions filter", () => {
    const out = room();
    for (const gone of ["room.question_toggle", "room.question_owner", "room.question_due", "room.filter_questions", "room.filter_all", "room.questions", "room.answer", "Open questions", "Mark answered"]) {
      expect(out, gone).not.toContain(gone);
    }
    expect(out).not.toMatch(/type="checkbox"/);
    expect(out).not.toContain('type="date"');
  });

  it("an old question row still reads as a message, with a small Question pill", () => {
    const out = room();
    expect(out).toContain("Who has the datasheet?");
    expect(out).toContain(">Question<");
  });

  it("is internal only: no client switch, no visible-to-client box", () => {
    for (const q of ["", "room=team"]) {
      const out = room(q);
      expect(out, q).not.toMatch(/With client|Visible to client|room\.visibility|room\.to_client/);
    }
  });

  it("every control is a 44 px target, with nothing fixed wide and no colour of its own", () => {
    for (const q of ["", "room=team", "room=decisions"]) {
      const out = room(q);
      for (const m of out.matchAll(/<(button|select|input)\b[^>]*>/g)) {
        const tag = m[0];
        if (/type="file"|role="tab"|aria-label="About /.test(tag)) continue;
        expect(tag, tag).toMatch(/min-height:\s*44px|minHeight:\s*44/);
      }
      expect(out, q).not.toMatch(/(?:^|[;"\s])width:\s*\d{3,}px/);
    }
  });

  it("the component source holds no colour literal", () => {
    const src = readFileSync(path.resolve(__dirname, "DealRoom.tsx"), "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("the Deal Room is one column: no grid of three panes", () => {
    const out = room();
    expect(out).not.toContain("dr-grid");
    expect(out).not.toContain("grid-template-columns");
  });
});
