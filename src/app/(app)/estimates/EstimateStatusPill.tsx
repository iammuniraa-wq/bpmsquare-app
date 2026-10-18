import StatusPill from "@/components/ui/StatusPill";
import type { PillarKey } from "@/lib/theme";

const TONE: Record<string, PillarKey> = { draft: "blue", quoted: "amber", won: "green", lost: "red" };
const LABEL: Record<string, string> = { draft: "Draft", quoted: "Quoted", won: "Won", lost: "Lost" };

export default function EstimateStatusPill({ status }: { status: string }) {
  return <StatusPill label={LABEL[status] ?? status} tone={TONE[status] ?? "blue"} />;
}
