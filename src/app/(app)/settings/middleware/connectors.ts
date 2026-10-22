import { CONNECTOR_CATALOG } from "@/lib/connectors/registry";
import type { ConnectorDef } from "@/lib/connectors/types";
import { ROUTES } from "@/lib/constants";

// Which connectors the Integration middleware page switches between. The list
// is read from the connector registry (an entry with `middleware: true`), so a
// connector added there appears as a chip without touching this page.

export type MiddlewareConnector = { id: string; name: string; shortName: string };

/** "Microsoft Dynamics 365" reads "Dynamics 365" in a chip or a status ("Sent to Dynamics 365"). */
export const shortName = (name: string): string => name.replace(/^Microsoft\s+/i, "").trim();

export function middlewareConnectors(catalog: readonly ConnectorDef[] = CONNECTOR_CATALOG): MiddlewareConnector[] {
  return catalog.filter((d) => d.middleware === true).map((d) => ({ id: d.id, name: d.name, shortName: d.shortName ?? shortName(d.name) }));
}

/**
 * What a connected product needs before a quote can go out, from its adapter
 * description. The live lists themselves come from the server; this only says
 * whether the "price list and currency" step applies to the product at all.
 */
const PRODUCT_NEEDS: Record<string, { pickLists: boolean }> = {
  dataverse: { pickLists: true },
  fo: { pickLists: false },
  bc: { pickLists: false },
};
export const needsPickLists = (productKey: string | null | undefined): boolean => (productKey ? PRODUCT_NEEDS[productKey]?.pickLists === true : false);

/** SAP S/4HANA only reads: it has no outbound link, so the page asks it for nothing to send and shows no steps about sending. */
export const SAP_S4 = "sap_s4";
export const hasOutbound = (connectorId: string): boolean => connectorId !== SAP_S4;

export const middlewareHref =(connectorId: string): string => `${ROUTES.settingsMiddleware}?connector=${encodeURIComponent(connectorId)}`;

/**
 * Where a connector tile on Settings, Connectors leads. With the flag on, a
 * syncing connector is managed on the middleware page; with it off the tile is
 * exactly what it was.
 */
export function connectorTileHref(def: Pick<ConnectorDef, "id" | "configureHref" | "middleware">, middlewareOn: boolean): string | undefined {
  return middlewareOn && def.middleware ? middlewareHref(def.id) : def.configureHref;
}
