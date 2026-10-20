import "server-only";
import { modulePage } from "@/lib/marketing/moduleAccess";
import { WHATSAPP_SPEC } from "@/lib/marketing/whatsapp/server";

/** The start of every WhatsApp page: the workcenter and both flags, then the context. Without the module: not found. */
export const whatsappPage = (action: "view" | "create" | "edit" = "view") => modulePage(WHATSAPP_SPEC, action);
