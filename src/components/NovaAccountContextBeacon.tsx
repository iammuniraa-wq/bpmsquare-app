"use client";

import { useEffect } from "react";

/**
 * Announces "the rep is currently looking at this account" to the rest of
 * the Nova chrome -- specifically NovaSidebar's Market Signals section
 * (owner request 2026-08-25: move Market Signals from the account page body
 * into the rail). The rail is rendered by Shell.tsx, a sibling of the page
 * content, not a descendant, so there's no prop path from the account page
 * down to it -- a window event is the same cross-tree-signal pattern this
 * app already uses for nova:open-palette/nova:open-draft/nova:browse-all.
 * Renders nothing; clears itself on unmount so navigating away from the
 * account (without landing on another one first) doesn't leave stale
 * context in the rail.
 */
export default function NovaAccountContextBeacon({ accountId, accountName }: { accountId: string; accountName: string }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("nova:account-context", { detail: { id: accountId, name: accountName } }));
    return () => {
      window.dispatchEvent(new CustomEvent("nova:account-context", { detail: null }));
    };
  }, [accountId, accountName]);

  return null;
}
