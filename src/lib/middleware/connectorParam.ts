import { SAP_CONNECTOR_ID } from "@/lib/connectors/sap_s4/types";

/** The page names the connector it is showing in `?connector=`; Dynamics 365 (the first connector) when absent or unknown. */
export function wantsSap(req: { url?: string }): boolean {
  if (typeof req?.url !== "string") return false;
  try {
    return new URL(req.url, "http://localhost").searchParams.get("connector") === SAP_CONNECTOR_ID;
  } catch {
    return false;
  }
}
