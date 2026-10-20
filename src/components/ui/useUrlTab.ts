"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Active tab for a client screen, kept in `?tab=` so a refresh or a shared
 * link lands on the same tab. The tab strip is the kit `Tabs` in state mode;
 * switching rewrites the URL with history.replaceState (no server round trip,
 * no remount), so everything the screen holds in state survives a switch.
 * The first id is the default and keeps the URL clean (no `?tab=`). A page
 * with two strips (a studio's canvas and its panel) gives the second its own
 * `key` ("panel"), so each lives in its own query parameter, and a `defaultId`
 * when the tab people come for is not the first one in the strip.
 */
export function useUrlTab(ids: readonly string[], key = "tab", defaultId: string = ids[0]): [string, (id: string) => void] {
  const params = useSearchParams();
  const fromUrl = params.get(key);
  // The raw value is kept even while it is not (yet) in `ids` -- a tab that
  // only exists after data loads (Roster's Project assignments) still opens
  // from a shared link once it appears.
  const [tab, setTabState] = useState<string>(fromUrl ?? defaultId);

  useEffect(() => {
    if (fromUrl) setTabState(fromUrl);
  }, [fromUrl]);

  const setTab = useCallback((id: string) => {
    setTabState(id);
    try {
      const url = new URL(window.location.href);
      if (id === defaultId) url.searchParams.delete(key);
      else url.searchParams.set(key, id);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* URL state is a convenience; the tab still switches */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join("|"), key, defaultId]);

  return [ids.includes(tab) ? tab : defaultId, setTab];
}
