// The dock's conversation is kept in this browser, per workspace, until the person starts a new chat or signs out.
export const DOCK_CHAT_KEY = "bpm-dock-chat-v1:";

/** Forget every saved dock conversation (called on sign-out so the next person on this browser starts blank). */
export function clearDockChats(): void {
  try {
    const gone: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DOCK_CHAT_KEY)) gone.push(k);
    }
    for (const k of gone) localStorage.removeItem(k);
  } catch { /* storage blocked: nothing was saved */ }
}
