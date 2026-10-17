"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Active tab for a client screen, kept in `?tab=` so a refresh or a shared
 * link lands on the same tab. The tab strip is the kit `Tabs` in state mode;
 * switching rewrites the URL with history.replaceState (no server round trip,
 * no remount), so everything the screen holds in state survives a switch.
 * The first id is the default and keeps the URL clean (no `?tab=`).
 */
export function useUrlTab(ids: readonly string[]): [string, (id: string) => void] {
  const params = useSearchParams();
  const fromUrl = params.get("tab");
  // The raw value is kept even while it is not (yet) in `ids` -- a tab that
  // only exists after data loads (Roster's Project assignments) still opens
  // from a shared link once it appears.
  const [tab, setTabState] = useState<string>(fromUrl ?? ids[0]);

  useEffect(() => {
    if (fromUrl) setTabState(fromUrl);
  }, [fromUrl]);

  const setTab = useCallback((id: string) => {
    setTabState(id);
    try {
      const url = new URL(window.location.href);
      if (id === ids[0]) url.searchParams.delete("tab");
      else url.searchParams.set("tab", id);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* URL state is a convenience; the tab still switches */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join("|")]);

  return [ids.includes(tab) ? tab : ids[0], setTab];
}
