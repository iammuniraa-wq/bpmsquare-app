"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";

/**
 * Nova pillar 5 — presence. Who else is looking at this record right now.
 *
 * Ephemeral Supabase Realtime presence channels (no table, no migration, no
 * server route): each viewer tracks their display name on a channel scoped to
 * the record, and everyone on it sees the live roster. Names are the only
 * payload. The channel key embeds the record's UUID, which is unguessable and
 * known only to people who can already open the record — plus the tenant id,
 * so two tenants' records can never share a channel even by collision.
 *
 * Returns the OTHER viewers' names (self excluded), deduped.
 */
export function usePresence(channelKey: string | null, selfKey: string | null, selfName: string | null): string[] {
  const [others, setOthers] = useState<string[]>([]);

  useEffect(() => {
    if (!channelKey || !selfKey || !selfName) return;
    const supabase = createBrowserSupabase();
    const channel = supabase.channel(`presence:${channelKey}`, {
      config: { presence: { key: selfKey } },
    });

    const sync = () => {
      const state = channel.presenceState<{ name: string }>();
      const names = Object.entries(state)
        .filter(([key]) => key !== selfKey)
        .flatMap(([, metas]) => metas.map((m) => m.name))
        .filter((n): n is string => typeof n === "string" && n.length > 0);
      setOthers([...new Set(names)]);
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ name: selfName });
        }
      });

    return () => {
      setOthers([]);
      void supabase.removeChannel(channel);
    };
  }, [channelKey, selfKey, selfName]);

  return others;
}
