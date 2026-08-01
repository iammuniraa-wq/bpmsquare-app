import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { listMarketingTargetGroups } from "@/lib/data";
import { c } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import SegmentsListClient from "./SegmentsListClient";

export default async function SegmentationPage() {
  await requireWorkcenterView("marketing_segments");
  await requireFeature("marketing");
  const groups = await listMarketingTargetGroups();

  return (
    <>
      <PageHeader
        title="Segmentation"
        subtitle={`${groups.length} target group${groups.length === 1 ? "" : "s"} -- build reusable audiences from account attributes`}
        action={
          <Link href={ROUTES.marketingSegmentNew} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.accent, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
            + New target group
          </Link>
        }
      />
      <SegmentsListClient groups={groups} />
    </>
  );
}
