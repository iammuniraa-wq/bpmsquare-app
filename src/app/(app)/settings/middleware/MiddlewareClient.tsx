"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import s from "./middleware.module.css";
import { getConnections, getHealth, getMessages, getRules } from "./api";
import { MiddlewareProvider, type MiddlewareCtx } from "./context";
import { middlewareConnectors, needsPickLists } from "./connectors";
import { filtersToQuery } from "./monitorLogic";
import { TAB_IDS, TAB_LABEL, deriveSetup, sentEvidence, type TabId } from "./setup";
import { useLoad } from "./ui";
import ConnectorSwitcher from "./ConnectorSwitcher";
import SetupGuide from "./SetupGuide";
import ConnectionsTab from "./ConnectionsTab";
import OutTab from "./OutTab";
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

  const connections = useLoad(getConnections, []);
  const health = useLoad(getHealth, [connectorId]);
  const rules = useLoad(getRules, [connectorId]);
  const evidence = useLoad(async () => {
    const page = await getMessages(filtersToQuery({ direction: "out", channel: "connector", status: "ok" }, { limit: 50 }));
    return sentEvidence(page.items);
  }, [connectorId]);

  const connection = connections.data?.find((c) => c.id === connectorId) ?? null;
  const reloadAll = useCallback(async () => {
    await Promise.all([connections.reload(), health.reload(), rules.reload(), evidence.reload()]);
  }, [connections, health, rules, evidence]);

  const productKey = health.data?.connection.product?.key ?? connection?.state.config?.product ?? null;
  const connected = health.data?.connection.connected ?? connection?.state.status === "connected";
  const setup = deriveSetup({
    connected: connected === true,
    pickListsApplicable: needsPickLists(productKey),
    priceListChosen: health.data?.connection.price_list_chosen ?? !!connection?.state.config?.price_list_id,
    currencyChosen: health.data?.connection.currency_chosen ?? !!connection?.state.config?.currency_id,
    outcomeOn: !!rules.data && (rules.data.rules.quote_awarded.enabled || rules.data.rules.quote_rejected.enabled),
    testSent: evidence.data?.testSent ?? false,
    realSeen: evidence.data?.realSeen ?? false,
  });

  const ctx: MiddlewareCtx = {
    connector,
    connection,
    connections,
    health,
    rules,
    evidence: evidence.data ?? { testSent: false, realSeen: false },
    reloadEvidence: evidence.reload,
    goTab: (t: TabId) => setTab(t),
    reloadAll,
  };

  const connectedBy: Record<string, boolean | undefined> = {};
  for (const c of connections.data ?? []) connectedBy[c.id] = c.state.status === "connected";

  return (
    <MiddlewareProvider value={ctx}>
      <div className={s.shell}>
        <ConnectorSwitcher connectors={connectors} value={connectorId} connected={connectedBy} onChange={setConnector} />
        <SetupGuide status={setup} loading={health.loading && !health.data} onOpen={setTab} />
        <Tabs
          label="Integration middleware"
          tabs={TAB_IDS.map((id) => ({ id, label: TAB_LABEL[id] }))}
          value={tab}
          onChange={(id) => setTab(id as TabId)}
        />
        <div role="tabpanel" aria-label={TAB_LABEL[tab as TabId]} key={`${connectorId}:${tab}`} className={s.stack}>
          {tab === "connections" && <ConnectionsTab />}
          {tab === "out" && <OutTab />}
          {tab === "mapping" && <MappingTab />}
          {tab === "monitor" && <MonitorTab />}
          {tab === "resync" && <ResyncTab />}
        </div>
      </div>
    </MiddlewareProvider>
  );
}
