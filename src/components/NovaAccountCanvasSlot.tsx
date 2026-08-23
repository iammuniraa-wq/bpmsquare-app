"use client";

import { useIsNextgen3Layer } from "@/lib/tenant-context";
import NovaAccountCanvas from "@/components/NovaAccountCanvas";
import type { CanvasNode, QuoteCanvasNode } from "@/lib/nova/accountCanvas";

/**
 * Nova-gated mount point for the Canvas (Constellation) graph, mirroring
 * NovaTimelineSlot/NovaAccountStorySlot's shape.
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
  const nova = useIsNextgen3Layer();
  if (!nova) return null;
  return <NovaAccountCanvas accountName={accountName} accountMeta={accountMeta} contactNodes={contactNodes} dealNodes={dealNodes} />;
}
