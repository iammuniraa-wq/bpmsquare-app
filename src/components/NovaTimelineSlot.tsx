"use client";

import { useNovaSurfaces } from "@/lib/tenant-context";
import NovaTimeline from "@/components/NovaTimeline";

/**
 * Nova-gated mount point for the record timeline. Every object detail page
 * is a SERVER component, so this thin client wrapper is what they render —
 * it self-gates (Nova or Spectacular -- see useNovaSurfaces) and renders
 * nothing for every other tenant, which keeps the pages themselves free of theme logic.
 *
 * Adding the timeline to a new object is one line on its detail page plus
 * an entry in the OBJECTS map in api/nova/comments (see bpmsquarecore §3b).
 */
export default function NovaTimelineSlot({ objectType, objectId }: { objectType: string; objectId: string }) {
  const nova = useNovaSurfaces();
  if (!nova) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <NovaTimeline objectType={objectType} objectId={objectId} />
    </div>
  );
}
