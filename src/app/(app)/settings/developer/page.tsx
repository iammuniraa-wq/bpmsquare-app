"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useFeel } from "@/components/FeelProvider";
import { c } from "@/lib/theme";
import { useTenant, useUserRole } from "@/lib/tenant-context";
import { ROUTES } from "@/lib/constants";
import { SETTINGS_TIPS } from "@/lib/settingsTips";
import InfoTip from "@/components/ui/InfoTip";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { Section } from "@/components/settings/generalShared";
import ApiKeysPanel from "./ApiKeysPanel";

export default function DeveloperSettingsPage() {
  const tenant = useTenant();
  const role = useUserRole();
  const { confirm } = useFeel();
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(tenant?.api_key ?? null);
  const [refCopied, setRefCopied] = useState(false);
  const [regenerating, startRegenerate] = useTransition();
  const [keyError, setKeyError] = useState("");

  const copyApiKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const copyReference = () => {
    navigator.clipboard.writeText(`${window.location.origin}/api/v1/openapi.json`).then(() => { setRefCopied(true); setTimeout(() => setRefCopied(false), 2000); });
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
      <SettingsPageHeader title="API keys & developer" info={SETTINGS_TIPS.developer} />

      <Section id="developer" title="">

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

        {role === "admin" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
          <div style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
            <span className="bpm-t-label">API reference</span>
            <InfoTip label="API reference">{SETTINGS_TIPS.apiReference}</InfoTip>
            <code style={{ fontSize: 12, color: c.ink, fontFamily: "monospace", marginLeft: 10 }}>/api/v1/openapi.json</code>
          </div>
          <button onClick={copyReference} style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: "pointer", flexShrink: 0, color: refCopied ? "var(--teal)" : c.muted }}>
            {refCopied ? "✓ Copied" : "Copy address"}
          </button>
          <Link href={ROUTES.settingsPush} style={{ fontSize: 12.5, color: c.accent, flexShrink: 0 }}>Webhooks</Link>
        </div>
        )}
      </Section>
    </div>
  );
}
