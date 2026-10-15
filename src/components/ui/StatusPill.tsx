import Pill from "@/components/Pill";
import type { PillarKey } from "@/lib/theme";

/**
 * Every status chip goes through here so the colour rules have one home. It
 * is deliberately a thin wrapper over Pill: a screen decides which tone a
 * status deserves (usually from its own `*_STATUS_TONE` map); this component
 * is where a change to how a tone looks gets made once.
 */
export default function StatusPill({ label, tone = "blue" }: { label: string; tone?: PillarKey }) {
  return <Pill label={label} tone={tone} />;
}
