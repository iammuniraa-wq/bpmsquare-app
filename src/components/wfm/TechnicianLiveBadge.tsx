import Pill from "@/components/Pill";
import type { PillarKey } from "@/lib/theme";
import type { PunchState } from "@/lib/wfm/types";

const LABEL: Record<PunchState, string> = { in: "On duty", break: "On break", out: "Off duty" };
const TONE: Record<PunchState, PillarKey> = { in: "green", break: "amber", out: "red" };

// Live WFM presence, distinct from the technician's static HR status
// (active/on_leave/inactive). Renders nothing when there's no signal --
// wfm off for the tenant, or this technician has no linked employee record.
export default function TechnicianLiveBadge({ state }: { state: PunchState | undefined }) {
  if (!state) return null;
  return <Pill label={LABEL[state]} tone={TONE[state]} />;
}
