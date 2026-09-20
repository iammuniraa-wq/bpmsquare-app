"use client";

import { useNovaSurfaces } from "@/lib/tenant-context";
import NovaAccountCanvas from "@/components/NovaAccountCanvas";
import type { CanvasNode, QuoteCanvasNode } from "@/lib/nova/accountCanvas";

/**
 * Mount point for the Canvas (Constellation) graph, mirroring
 * NovaTimelineSlot/NovaAccountStorySlot's shape.
 *
 * Gated on useNovaSurfaces(), so Spectacular gets it as well as Nova. WHERE
 * it mounts differs by theme and that is the page's call, not this file's:
 * Nova renders it on its own account landing view, everyone else inline on
 * the overview tab (accounts/[id]/page.tsx).
 */
export default function NovaAccountCanvasSlot({
  accountName,
  accountMeta,
  contactNodes,
  dealNodes,
}: {
  accountName: string;
  accountMeta: string;
  contactNodes: CanvasNode[];
  dealNodes: QuoteCanvasNode[];
}) {
  const nova = useNovaSurfaces();
  if (!nova) return null;
  return <NovaAccountCanvas accountName={accountName} accountMeta={accountMeta} contactNodes={contactNodes} dealNodes={dealNodes} />;
}
