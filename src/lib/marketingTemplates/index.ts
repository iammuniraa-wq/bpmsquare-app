// Aggregates every festival/occasion template folder into one flat list for
// the picker and the server-side renderer. Adding a new festival means
// adding one file in this folder + one line here -- never touching the
// picker UI or the send route.

import type { MarketingTemplateDef } from "./shared";
import { DIWALI_TEMPLATES } from "./diwali";
import { HOLI_TEMPLATES } from "./holi";
import { RAKSHA_BANDHAN_TEMPLATES } from "./rakshaBandhan";
import { GANESH_CHATURTHI_TEMPLATES } from "./ganeshChaturthi";
import { NAVRATRI_DUSSEHRA_TEMPLATES } from "./navratriDussehra";
import { EID_TEMPLATES } from "./eid";
import { CHRISTMAS_TEMPLATES } from "./christmas";
import { MAKAR_SANKRANTI_TEMPLATES } from "./makarSankranti";
import { NEW_YEAR_TEMPLATES } from "./newYear";
import { INDEPENDENCE_DAY_TEMPLATES } from "./independenceDay";
import { REPUBLIC_DAY_TEMPLATES } from "./republicDay";
import { SERVICE_REMINDER_TEMPLATES } from "./serviceReminder";

export type { MarketingTemplateDef } from "./shared";
export { escapeCustomMessage } from "./shared";

/** No longer a strict literal union -- 55+ ids across festival files would
 * make hand-listing every one unwieldy. getMarketingTemplate()'s array
 * lookup (not the type) is the actual runtime safety boundary. */
export type MarketingTemplateId = string;

export const MARKETING_TEMPLATES: MarketingTemplateDef[] = [
  ...DIWALI_TEMPLATES,
  ...HOLI_TEMPLATES,
  ...RAKSHA_BANDHAN_TEMPLATES,
  ...GANESH_CHATURTHI_TEMPLATES,
  ...NAVRATRI_DUSSEHRA_TEMPLATES,
  ...EID_TEMPLATES,
  ...CHRISTMAS_TEMPLATES,
  ...MAKAR_SANKRANTI_TEMPLATES,
  ...NEW_YEAR_TEMPLATES,
  ...INDEPENDENCE_DAY_TEMPLATES,
  ...REPUBLIC_DAY_TEMPLATES,
  ...SERVICE_REMINDER_TEMPLATES,
];

export function getMarketingTemplate(id: string | null | undefined): MarketingTemplateDef | null {
  return MARKETING_TEMPLATES.find((t) => t.id === id) ?? null;
}
