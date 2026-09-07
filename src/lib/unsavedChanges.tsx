"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFeel } from "@/components/FeelProvider";

// Unsaved-changes guard (owner report 2026-09-07: a line removed on a quote
// and the page closed without saving gave no warning at all). One page at a
// time registers itself as dirty; every way of leaving it then asks first:
//
//   - the browser (close tab, reload, typed URL): the native beforeunload
//     prompt, the only thing a browser allows there;
//   - an in-app link (sidebar, breadcrumb, any <Link>): intercepted in the
//     capture phase before Next's own handler, then the app's confirm dialog;
//   - the app tab bar (closing or switching tabs): tabs-context asks
//     confirmLeave() before it navigates.
//
// A module-level singleton rather than a context: only one editable page is
// ever mounted, and tabs-context (which sits above every page) needs to ask
// without the page threading anything up to it.

type Guard = { confirm: () => Promise<boolean> };
let active: Guard | null = null;

export function setUnsavedGuard(guard: Guard | null): void {
  active = guard;
}

/** True when the mounted page has edits that are not saved. */
export function hasUnsavedChanges(): boolean {
  return active !== null;
}

/** Ask the dirty page (if any) whether it is fine to leave. Resolves true
 *  straight away when nothing is dirty. */
export function confirmLeave(): Promise<boolean> {
  return active ? active.confirm() : Promise.resolve(true);
}

/**
 * Register this page as dirty while `dirty` is true. Call it once in the
 * editing component; flip `dirty` to false right before a successful save
 * navigates away so the save itself is never questioned.
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  opts: { title?: string; body?: string } = {}
): void {
  const { confirm } = useFeel();
  const router = useRouter();
  const title = opts.title ?? "Leave without saving?";
  const body = opts.body ?? "You have unsaved changes on this page. If you leave now they will be lost.";

  useEffect(() => {
    if (!dirty) { setUnsavedGuard(null); return; }

    const guard: Guard = {
      confirm: () => confirm({ title, body, confirmLabel: "Leave and discard", tone: "danger" }),
    };
    setUnsavedGuard(guard);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome still needs a non-empty returnValue to show the prompt.
      e.returnValue = "";
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      // A different origin is a full page load; beforeunload covers it.
      if (url.origin !== window.location.origin) return;
      const current = window.location.pathname + window.location.search;
      if (url.pathname + url.search === current) return;
      e.preventDefault();
      e.stopPropagation();
      void guard.confirm().then((ok) => {
        if (!ok) return;
        setUnsavedGuard(null);
        router.push(url.pathname + url.search + url.hash);
      });
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    // Capture on document runs before React's root listener, so Next's
    // <Link> never sees the click when the user decides to stay.
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      setUnsavedGuard(null);
    };
  }, [dirty, confirm, router, title, body]);
}
