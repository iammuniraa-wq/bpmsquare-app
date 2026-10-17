"use client";

import { useState, useTransition } from "react";
import { useFeel } from "@/components/FeelProvider";
import { c } from "@/lib/theme";
import { useTenant, useUserRole } from "@/lib/tenant-context";
import { Mail, MessageSquare, LinkIcon, Globe, Phone } from "@/components/Icons";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { Section, StatusBadge } from "@/components/settings/generalShared";
import ApiKeysPanel from "./ApiKeysPanel";

// ── Integration catalogue ─────────────────────────────────────────────────────

const INTEGRATIONS = [
  {
    icon: <Mail size={16} />, name: "Email — Resend",
    desc: "Send quotations and invoices directly from the system as PDF attachments, from your own sender identity",
    status: "active" as const,
    note: "Free tier: 3,000 emails/month · where mail is delivered is governed by Settings → Email output · inspection reports not wired up yet",
  },
  {
    icon: <MessageSquare size={16} />, name: "WhatsApp (embedded)",
    desc: "Message contacts from cases, quotations and work orders via the Meta Business API — automated sends, delivery receipts, full inbox",
    status: "coming-soon" as const,
    note: "Meta Cloud API · 1,000 free conversations/month · recommended for India · a lighter-weight WhatsApp (external) option is already live on quotes and cases — opens a pre-filled wa.me chat for a rep to send manually",
  },
  {
    icon: <LinkIcon size={16} />, name: "Webhooks",
    desc: "Push real-time events to your systems when cases or quotations change status",
    status: "coming-soon" as const,
    note: "POST to any URL on: case.created, case.status_changed, quote.approved, invoice.sent",
  },
  {
    icon: <Globe size={16} />, name: "MCP Server",
    desc: "Allow any AI assistant to read and write CRM data via Model Context Protocol",
    status: "ready" as const,
    note: "Config at mcp-server/mcp.json · connect to Claude, Cursor, or any MCP-compatible client",
  },
  {
    icon: <Phone size={16} />, name: "PWA / Mobile app",
    desc: "Install on Android or iOS for field staff — the punch page works offline",
    status: "active" as const,
    note: "Add to Home Screen to install · a service worker caches the app shell so My Workforce loads and lets you punch with no network; punches queue and sync when back online",
  },
];

const API_ENDPOINTS = [
  { method: "GET", path: "/api/v1",                    desc: "API index + auth info" },
  { method: "GET", path: "/api/v1/accounts",            desc: "List all accounts with counts" },
  { method: "GET", path: "/api/v1/accounts/:id",        desc: "Account detail — contacts, cases, quotes, WOs" },
  { method: "GET", path: "/api/v1/cases",               desc: "List cases · filter: ?status= &account_id=" },
  { method: "GET", path: "/api/v1/quotations",          desc: "List quotations · filter: ?status= &account_id=" },
  { method: "GET", path: "/api/v1/products",            desc: "List products · filters: ?category=, ?status=" },
  { method: "GET", path: "/api/v1/products/:id",        desc: "Product detail" },
  { method: "GET", path: "/api/v1/opportunities",       desc: "List deals · filters: ?stage=, ?outcome=, ?account_id=" },
  { method: "GET", path: "/api/v1/opportunities/:id",   desc: "Deal detail with lines and linked quotes" },
  { method: "GET", path: "/api/v1/rfqs",                desc: "List RFQs · key must be scoped to rfqs · filters: ?status=, ?origin_type=" },
  { method: "GET", path: "/api/v1/estimates",           desc: "List project estimates · key must be scoped to estimates · customer-safe fields only (no costs) · filters: ?status=, ?account_id=" },
  { method: "GET", path: "/api/v1/estimates/:id",       desc: "One estimate: customer, template, status and quoted price" },
  { method: "GET", path: "/api/v1/rfqs/:id",            desc: "RFQ with lines, suppliers, quoted prices and awards" },
  { method: "GET", path: "/api/v1/projects",            desc: "Workforce projects + sub-projects · filters: ?status=, ?level=, ?parent_id=" },
  { method: "GET", path: "/api/v1/projects/:id",        desc: "Project detail — parent, level, sub-projects, links" },
  { method: "GET", path: "/api/v1/projects/:id/hours",  desc: "Hours for a project and its sub-projects, for a period (?from=&to=)" },
  { method: "GET", path: "/api/v1/projects/:id/invoices", desc: "Invoices raised from a project's hours" },
  { method: "POST", path: "/api/v1/projects/:id/invoices", desc: "Raise a draft invoice for a period ({from, to, granularity?, dry_run?})" },
  { method: "GET", path: "/api/v1/project-hours",       desc: "Hours by project, one row per work session, with bill rate and invoiced flag · group_by / aggregates supported" },
  { method: "GET", path: "/api/v1/inventory",           desc: "List inventory · filter: ?low_stock=true" },
  { method: "GET", path: "/api/v1/inventory/:id",       desc: "Inventory item detail + transaction history" },
  { method: "GET", path: "/api/v1/invoices",            desc: "List invoices · filter: ?status= &account_id=" },
  { method: "GET", path: "/api/v1/invoices/:id",        desc: "Invoice detail — lines, payments, balance due" },
  { method: "GET", path: "/api/v1/purchase-orders",     desc: "List POs · filter: ?status= &supplier_id=" },
  { method: "GET", path: "/api/v1/purchase-orders/:id", desc: "Purchase order detail + receiving progress" },
  { method: "GET", path: "/api/v1/employees",           desc: "List staff · filter: ?status= &department= · key must name the employees scope" },
  { method: "GET", path: "/api/v1/employees/:id",       desc: "Employee detail" },
];

const API_COMING_SOON = [
  "POST /api/v1/cases",
  "PATCH /api/v1/cases/:id/status",
  "POST /api/v1/quotations",
  "GET  /api/v1/openapi.json",
  "POST /api/v1/webhooks",
];

export default function DeveloperSettingsPage() {
  const tenant = useTenant();
  const role = useUserRole();
  const { confirm } = useFeel();
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(tenant?.api_key ?? null);
  const [regenerating, startRegenerate] = useTransition();
  const [keyError, setKeyError] = useState("");

  const copyApiKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const regenerateApiKey = async () => {
    if (apiKey && !(await confirm({ title: "Generate a new API key?", body: "The current key stops working immediately. Anything using it — an ERP integration, an AI assistant's MCP config — needs the new one.", confirmLabel: "Generate", tone: "danger" }))) return;
    setKeyError("");
    startRegenerate(async () => {
      const res = await fetch("/api/settings/api-key", { method: "POST" });
      const json = await res.json();
      if (res.ok) setApiKey(json.api_key);
      else setKeyError(json.error ?? "Failed to generate key");
    });
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader
        title="API keys & developer"
        subtitle="Live REST API with an enriched query layer, an OpenAPI spec and a change feed. Authenticate with: Authorization: Bearer <API key>"
      />

      <Section
        id="developer"
        title=""
        description="Live REST API with an enriched query layer (filter / select / sort / aggregate / search), an OpenAPI spec and a change feed. Authenticate with: Authorization: Bearer <API key>"
      >

        {/* API key row — admin only: this key grants read access to every
            account/case/quote/invoice/etc. in this tenant via the v1 API. */}
        {role === "admin" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 12px", background: c.panel2, borderRadius: 8, border: `1px solid ${c.line}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bpm-t-help" style={{ marginBottom: 2 }}>API Key</div>
              {apiKey ? (
                <code style={{ fontSize: 12.5, color: c.ink, fontFamily: "monospace", wordBreak: "break-all" }}>{apiKey}</code>
              ) : (
                <div style={{ fontSize: 12.5, color: c.hint, fontStyle: "italic" }}>No key generated yet</div>
              )}
              {keyError && <div style={{ fontSize: 11, color: "var(--err-ink)", marginTop: 3 }}>{keyError}</div>}
            </div>
            {apiKey && (
              <button onClick={copyApiKey} style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: "pointer", flexShrink: 0, color: copied ? "var(--teal)" : c.muted }}>
                {copied ? "✓ Copied" : "Copy key"}
              </button>
            )}
            <button onClick={regenerateApiKey} disabled={regenerating} style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: regenerating ? "not-allowed" : "pointer", flexShrink: 0, color: c.muted }}>
              {regenerating ? "…" : apiKey ? "Regenerate" : "Generate key"}
            </button>
          </div>
        ) : (
          <div className="bpm-t-help" style={{ marginBottom: 14 }}>Ask a workspace admin to generate or view the API key.</div>
        )}

        {role === "admin" && <ApiKeysPanel />}

        {/* Endpoints */}
        <div style={{ marginBottom: 12 }}>
          <div className="bpm-t-label" style={{ marginBottom: 8 }}>Available now</div>
          {API_ENDPOINTS.map((ep) => (
            <div key={ep.path} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${c.line}` }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--blueink)", background: "var(--bluebg)", borderRadius: 5, padding: "2px 7px", flexShrink: 0, fontFamily: "monospace" }}>{ep.method}</span>
              <code style={{ fontSize: 12, color: c.ink, flex: 1, fontFamily: "monospace" }}>{ep.path}</code>
              <span style={{ fontSize: 11, color: c.muted, textAlign: "right" }}>{ep.desc}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="bpm-t-label" style={{ marginBottom: 8 }}>Coming soon</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {API_COMING_SOON.map((ep) => (
              <code key={ep} style={{ fontSize: 11, color: c.hint, background: c.panel2, borderRadius: 5, padding: "3px 8px", border: `1px solid ${c.line}`, fontFamily: "monospace" }}>
                {ep}
              </code>
            ))}
          </div>
        </div>
      </Section>

      <Section
        id="integrations"
        title="Available integrations"
        description="Connect external services. Items marked Coming Soon are on the roadmap."
      >
        {INTEGRATIONS.map((intg, idx) => (
          <div key={intg.name} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 4px", borderTop: idx > 0 ? `1px solid ${c.line}` : "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: c.panel2, border: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
              {intg.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{intg.name}</span>
                <StatusBadge status={intg.status} />
              </div>
              <div className="bpm-t-help">{intg.desc}</div>
              <div className="bpm-t-help" style={{ marginTop: 3 }}>{intg.note}</div>
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}
