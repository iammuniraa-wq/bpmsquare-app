import StatusPill from "@/components/ui/StatusPill";
import type { PillarKey } from "@/lib/theme";

const TONE: Record<string, PillarKey> = {
  finished_product: "green",
  semi_finished: "teal",
  raw_material: "amber",
  bought_out_component: "blue",
  consumable: "amber",
  custom_made_to_order: "purple",
  service: "teal",
  tool_equipment: "purple",
  certification_document: "blue",
  bom_kit: "purple",
};

/** A product's item type as a chip. `label` is the tenant's name for it
 *  (itemTypeLabel); a custom type has no tone of its own and reads blue. */
export default function ItemTypeBadge({ typeKey, label }: { typeKey: string | null | undefined; label: string | null }) {
  if (!typeKey || !label) return null;
  return <StatusPill label={label} tone={TONE[typeKey] ?? "blue"} />;
}
