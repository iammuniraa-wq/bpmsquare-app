import StatusPill from "@/components/ui/StatusPill";
import type { PillarKey } from "@/lib/theme";
import { STUDY_STATUS_LABEL, type StudyStatus } from "@/lib/studio/types";

const TONE: Record<StudyStatus, PillarKey> = {
  telling: "blue", mapped: "blue", fit_ready: "blue", changes_ready: "blue", plan_ready: "purple",
  submitted: "amber", reviewed: "green", accepted: "green", rescoped: "amber", closed: "red",
};

export default function StudyStatusPill({ status }: { status: StudyStatus }) {
  return <StatusPill label={STUDY_STATUS_LABEL[status] ?? status} tone={TONE[status] ?? "blue"} />;
}
