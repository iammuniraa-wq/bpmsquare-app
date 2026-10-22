"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import s from "./middleware.module.css";
import { getConnections, getDocuments, getHealth, getMessages, getRules, getSync, setActiveConnector } from "./api";
import { MiddlewareProvider, type MiddlewareCtx } from "./context";
import { hasOutbound, middlewareConnectors } from "./connectors";
import { expiryChip, healthBanner } from "./connectionLogic";
import { documentsConfirmed } from "./documentsLogic";
import { filtersToQuery } from "./monitorLogic";
import { TAB_IDS, TAB_LABEL, deriveInboundSetup, deriveSetup, sentEvidence, type SetupTarget, type TabId } from "./setup";
import { Notice, useLoad } from "./ui";
import ConnectorSwitcher from "./ConnectorSwitcher";
import SetupGuide from "./SetupGuide";
import ConnectionPanel, { useAuthReturn } from "./ConnectionPanel";
import LinksTab from "./LinksTab";
import MappingTab from "./MappingTab";
import MonitorTab from "./MonitorTab";
import ResyncTab from "./ResyncTab";

/** The chosen connector lives in `?connector=` (always written), so a link or a reload keeps it. */
function useConnectorParam(ids: readonly string[]): [string, (id: string) => void] {
  const params = useSearchParams();
  const fromUrl = params.get("connector");
  const valid = (v: string | null): v is string => !!v && ids.includes(v);
  const [id, setId] = useState<string>(valid(fromUrl) ? fromUrl : ids[0]);

  const write = useCallback((next: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("connector", next);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* the URL is a convenience; the page still switches */ }
  }, []);

  useEffect(() => { if (valid(fromUrl)) setId(fromUrl); }, [fromUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!fromUrl) write(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((next: string) => { setId(next); write(next); }, [write]);
  return [ids.includes(id) ? id : ids[0], set];
}

export default function MiddlewareClient() {
  const connectors = useMemo(() => middlewareConnectors(), []);
  const [connectorId, setConnector] = useConnectorParam(connectors.map((c) => c.id));
  const [tab, setTab] = useUrlTab(TAB_IDS);
  const connector = connectors.find((c) => c.id === connectorId) ?? connectors[0];
  // Every call below names this connector (api.ts); set before the first one is made.
  setActiveConnector(connector.id);
  const authReturn = useAuthReturn();
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => { if (authReturn) setPanelOpen(true); }, [authReturn]);

  const connections = useLoad(getConnections, []);
  const health = useLoad(getHealth, [connectorId]);
  const rules = useLoad(getRules, [connectorId]);
  const documents = useLoad(getDocuments, [connectorId]);
  const sync = useLoad(getSync, [connectorId]);
  const evidence = useLoad(async () => {
    if (!hasOutbound(connectorId)) return { testSent: false, realSeen: false };
    const page = await getMessages(filtersToQuery({ direction: "out", channel: "connector", status: "ok" }, { limit: 50 }));
    return sentEvidence(page.items);
  }, [connectorId]);

  const connection = connections.data?.find((c) => c.id === connectorId) ?? null;
  const reloadAll = useCallback(async () => {
    await Promise.all([connections.reload(), health.reload(), rules.reload(), documents.reload(), sync.reload(), evidence.reload()]);
  }, [connections, health, rules, documents, sync, evidence]);

  const connected = health.data?.connection.connected ?? connection?.state.status === "connected";
  const customers = sync.data && sync.data.connected ? sync.data.entities.find((e) => e.key === "customers") : undefined;
  const inboundOnly = !hasOutbound(connector.id);
  const customersSynced = !!sync.data && sync.data.connected && (!customers || customers.linked > 0);
  const setup = inboundOnly ? deriveInboundSetup({ connected: connected === true, customersSynced }) : deriveSetup({
    connected: connected === true,
    outcomeOn: !!documents.data && documents.data.documents.some((d) => d.enabled),
    outcomeConfirmed: documentsConfirmed(documents.data?.documents),
    // A product with no customers pull has nothing to wait for.
    customersSynced,
    testSent: evidence.data?.testSent ?? false,
    realSeen: evidence.data?.realSeen ?? false,
  });

  const ctx: MiddlewareCtx = {
    connector,
    connection,
    connections,
    health,
    rules,
    documents,
    sync,
    evidence: evidence.data ?? { testSent: false, realSeen: false },
    reloadEvidence: evidence.reload,
    goTab: (t: TabId) => setTab(t),
    openConnection: () => setPanelOpen(true),
    reloadAll,
  };

  const connectedBy: Record<string, boolean | undefined> = {};
  for (const c of connections.data ?? []) connectedBy[c.id] = c.state.status === "connected";

  const openTarget = (t: SetupTarget) => { if (t === "connection") setPanelOpen(true); else setTab(t); };
  const banner = healthBanner(health.data);
  // No stored connection at all: one empty state instead of tabs that have nothing to show.
  const noConnection = !!connections.data && !connection?.state.config;

  return (
    <MiddlewareProvider value={ctx}>
      <div className={s.shell}>
        <ConnectorSwitcher
          connectors={connectors} value={connectorId} connected={connectedBy} expiry={expiryChip(health.data)}
          onChange={setConnector} onManage={() => setPanelOpen(true)}
        />
        {banner && <Notice tone="warn">{banner}</Notice>}
        {noConnection ? (
          <EmptyState
            title={`Connect ${connector.shortName}`} text={inboundOnly ? "Sign in once; customers, suppliers and products then come in from it." : "Sign in once; quotes, customers and products then move between the two."}
            action={<Button variant="primary" data-guide="middleware.connect" onClick={() => setPanelOpen(true)}>Connect {connector.shortName}</Button>}
          />
        ) : (
          <>
            <SetupGuide status={setup} loading={(health.loading && !health.data) || (!inboundOnly && documents.loading && !documents.data)} onOpen={openTarget} />
            <Tabs
              label="Integration middleware"
              tabs={TAB_IDS.map((id) => ({ id, label: TAB_LABEL[id] }))}
              value={tab}
              onChange={(id) => setTab(id as TabId)}
            />
            <div role="tabpanel" aria-label={TAB_LABEL[tab as TabId]} key={`${connectorId}:${tab}`} className={s.stack}>
              {tab === "links" && <LinksTab />}
              {tab === "mapping" && <MappingTab />}
              {tab === "monitor" && <MonitorTab />}
              {tab === "resync" && <ResyncTab />}
            </div>
          </>
        )}
        {panelOpen && <ConnectionPanel authReturn={authReturn} onClose={() => setPanelOpen(false)} />}
      </div>
    </MiddlewareProvider>
  );
}
