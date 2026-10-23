// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DOCK_CHAT_KEY, clearDockChats } from "./dockChat";

describe("the saved dock conversation", () => {
  beforeEach(() => localStorage.clear());
  it("is forgotten on sign-out for every workspace, and nothing else is touched", () => {
    localStorage.setItem(`${DOCK_CHAT_KEY}t1`, "[]");
    localStorage.setItem(`${DOCK_CHAT_KEY}t2`, "[]");
    localStorage.setItem("bms_ai_dock_enabled", "1");
    clearDockChats();
    expect(localStorage.getItem(`${DOCK_CHAT_KEY}t1`)).toBeNull();
    expect(localStorage.getItem(`${DOCK_CHAT_KEY}t2`)).toBeNull();
    expect(localStorage.getItem("bms_ai_dock_enabled")).toBe("1");
  });
});
