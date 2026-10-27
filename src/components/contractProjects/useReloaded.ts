"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { reloadAfterSave } from "@/components/tender/refreshAfterSave";

// After an action on a contract project tab the screen must show what the action changed without a manual reload. Two things change: the
// tab's own data (a variation's status, a milestone's invoice) and the facts the server renders around it (the header tiles, the status
// chip, the Revisions count). `reload()` therefore does both, in the shape the tender screens already use (reloadAfterSave): it
// re-reads the tab's own endpoint at once and applies it, then asks the router to re-render the page. The re-read never decides whether
// the action worked, and a failed re-read still refreshes the page. The server render replaces the local copy whenever it arrives.

export function useReloaded<T>(url: string, fromServer: T): { data: T; reload: () => Promise<void> } {
  const router = useRouter();
  const [data, setData] = useState<T>(fromServer);
  useEffect(() => { setData(fromServer); }, [fromServer]);
  const reload = useCallback(async () => { await reloadAfterSave<T>(url, setData, () => router.refresh()); }, [url, router]);
  return { data, reload };
}
