"use client";

import { useIsNextgen3Layer } from "@/lib/tenant-context";
import NovaTimeline from "@/components/NovaTimeline";

/**
 * Nova-gated mount point for the record timeline. Every object detail page
 * is a SERVER component, so this thin client wrapper is what they render —
 * it self-gates on the Nova flag and renders nothing for every other
 * tenant, which keeps the pages themselves free of theme logic.
 *
 * Adding the timeline to a new object is one line on its detail page plus
 * an entry in the OBJECTS map in api/nova/comments (see bpmsquarecore §3b).
 */
export default function NovaTimelineSlot({ objectType, objectId }: { objectType: string; objectId: string }) {
  const nova = useIsNextgen3Layer();
  if (!nova) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <NovaTimeline objectType={objectType} objectId={objectId} />
    </div>
  );
}
