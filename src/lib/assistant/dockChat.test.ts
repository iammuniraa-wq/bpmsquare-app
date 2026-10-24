import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCK_CHAT_KEY, clearDockChats } from "./dockChat";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

describe("the saved dock conversation", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());
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
