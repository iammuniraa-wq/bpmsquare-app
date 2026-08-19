"use client";

import { useIsNextgen3Layer } from "@/lib/tenant-context";
import FlowBoard from "@/components/FlowBoard";
import PageHeader from "@/components/PageHeader";

/**
 * Nova gate for the Flow Board. A tenant without the flag keeps the
 * Pipeline placeholder it has today -- the board never half-appears.
 */
export default function FlowBoardSlot({ fallback }: { fallback: React.ReactNode }) {
  const nova = useIsNextgen3Layer();
  if (!nova) return <>{fallback}</>;
  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle="Every open quotation, by stage and by how long it has sat there"
      />
      <FlowBoard />
    </>
  );
}
