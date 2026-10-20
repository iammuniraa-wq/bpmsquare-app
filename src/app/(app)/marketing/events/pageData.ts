import "server-only";
import { modulePage } from "@/lib/marketing/moduleAccess";
import { EVENTS_SPEC } from "@/lib/marketing/events/server";

/** The start of every Events page: the workcenter and all three flags, then the context. Without the module: not found. */
export const eventsPage = (action: "view" | "create" | "edit" = "view") => modulePage(EVENTS_SPEC, action);
