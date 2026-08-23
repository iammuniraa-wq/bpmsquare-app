"use client";

import { useIsNextgen3Layer } from "@/lib/tenant-context";
import NovaAccountStory from "@/components/NovaAccountStory";
import type { AccountStoryEvent } from "@/lib/nova/accountStory";
import type { Account360Rating } from "@/lib/account360/types";

/**
 * Nova-gated mount point for the Account story timeline, mirroring
 * NovaTimelineSlot's shape: the account hub page is a server component, so
 * this thin client wrapper self-gates on the flag and renders nothing for
 * every other tenant, keeping the page itself free of theme logic.
 */
export default function NovaAccountStorySlot({
  accountName,
  events,
  health,
}: {
  accountName: string;
  events: AccountStoryEvent[];
  health: Account360Rating;
}) {
  const nova = useIsNextgen3Layer();
  if (!nova) return null;
  return <NovaAccountStory accountName={accountName} events={events} health={health} />;
}
