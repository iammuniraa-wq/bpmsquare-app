"use client";

import { createContext, useContext } from "react";
import type { ConnectionItem, DocumentsView, HealthView, RulesView, SyncOverview } from "./api";
import type { MiddlewareConnector } from "./connectors";
import type { TabId } from "./setup";

// What every tab reads from the page: the selected connector and what the page
// has already loaded about it. A tab reloads a piece after it changes it.

export type Piece<T> = { data: T | null; setData: (d: T | null) => void; error: unknown; loading: boolean; reload: () => Promise<void> };

export type MiddlewareCtx = {
  connector: MiddlewareConnector;
  connection: ConnectionItem | null;
  connections: Piece<ConnectionItem[]>;
  health: Piece<HealthView>;
  rules: Piece<RulesView>;
  /** The outbound links: one entry per document. */
  documents: Piece<DocumentsView>;
  /** The inbound links and their schedules: one entry per entity. */
  sync: Piece<SyncOverview>;
  evidence: { testSent: boolean; realSeen: boolean };
  reloadEvidence: () => Promise<void>;
  goTab: (tab: TabId) => void;
  /** Open the connection panel behind the connector chip. */
  openConnection: () => void;
  /** Re-read connection, health, links and sync after anything that changes them. */
  reloadAll: () => Promise<void>;
};

const Ctx = createContext<MiddlewareCtx | null>(null);
export const MiddlewareProvider = Ctx.Provider;

export function useMw(): MiddlewareCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMw outside the Integration middleware page");
  return v;
}
