"use client";

import { useState, useTransition } from "react";
import { useFeel } from "@/components/FeelProvider";
import { c } from "@/lib/theme";
import type { TenantConfig } from "@/lib/constants";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { useTenant, useUserRole } from "@/lib/tenant-context";
import PageHeader from "@/components/PageHeader";
import { AdminOnlyNotice, Section, useSavedFlash } from "@/components/settings/generalShared";
import WebhooksPanel from "./WebhooksPanel";

export default function WebhooksAndPushPage() {
  const { settings } = useSettings();
  const tenant = useTenant();
  const role = useUserRole();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;

  // Push to external systems (on demand) -- see lib/webhookPush.ts
  const pushConfig = (tenant?.config as TenantConfig | undefined)?.integration_push;
  const [pushUrl, setPushUrl] = useState(pushConfig?.webhook_url ?? "");
  const [pushSecret, setPushSecret] = useState(pushConfig?.webhook_secret ?? "");
  const [pushSaving, startPushSave] = useTransition();
  const [pushSecretSaving, startPushSecretSave] = useTransition();
  const [pushSaved, flashPushSaved] = useSavedFlash();
  const [pushError, setPushError] = useState("");

  const savePushUrl = () => {
    setPushError("");
    startPushSave(async () => {
      const res = await fetch("/api/settings/integration-push", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhook_url: pushUrl.trim() }),
      });
      const json = await res.json();
      if (res.ok) flashPushSaved();
      else setPushError(json.error ?? "Failed to save");
    });
  };

  const { confirm } = useFeel();
  const regeneratePushSecret = async () => {
    if (pushSecret && !(await confirm({ title: "Generate a new signing secret?", body: "The old secret stops verifying the moment this is done — update it on the receiving end too.", confirmLabel: "Generate", tone: "danger" }))) return;
    setPushError("");
    startPushSecretSave(async () => {
      const res = await fetch("/api/settings/integration-push", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate_secret: true }),
      });
      const json = await res.json();
      if (res.ok) setPushSecret(json.webhook_secret ?? "");
      else setPushError(json.error ?? "Failed to generate secret");
    });
  };

  if (role !== "admin") {
    return (
      <div style={{ maxWidth: 680 }}>
        <PageHeader title="Webhooks & push" subtitle="Send events and single records to your other systems." />
        <AdminOnlyNotice what="configure webhooks and push to external systems" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <PageHeader title="Webhooks & push" subtitle="Send events and single records to your other systems." />

      <WebhooksPanel />

      <Section
        id="push"
        title="Push to external systems"
        description="Send a single record to your ERP or another system right now, on demand -- a rep clicking &quot;Push to ERP&quot; on a record. Different from the outbound webhooks above (automatic, event-driven)."
      >
        {role === "admin" ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Receiving URL</label>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  value={pushUrl}
                  onChange={(e) => setPushUrl(e.target.value)}
                  placeholder="https://your-erp.example.com/webhooks/bpmsquare"
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, outline: "none" }}
                />
                <button onClick={savePushUrl} disabled={pushSaving} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, border: "none", cursor: pushSaving ? "not-allowed" : "pointer", background: pushSaved ? "var(--teal)" : accent, color: "#fff" }}>
                  {pushSaving ? "Saving…" : pushSaved ? "✓ Saved" : "Save"}
                </button>
              </div>
              {pushError && <div style={{ fontSize: 11.5, color: "var(--err-ink)", marginTop: 6 }}>{pushError}</div>}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: c.panel2, borderRadius: 8, border: `1px solid ${c.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: c.muted, marginBottom: 2 }}>Signing secret</div>
                {pushSecret ? (
                  <code style={{ fontSize: 12.5, color: c.ink, fontFamily: "monospace", wordBreak: "break-all" }}>{pushSecret}</code>
                ) : (
                  <div style={{ fontSize: 12.5, color: c.hint, fontStyle: "italic" }}>Not generated -- pushes will be unsigned</div>
                )}
                <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>Sent as the X-BPMSquare-Signature header (HMAC-SHA256 of the request body) so your endpoint can verify it's really from BPMSquare.</div>
              </div>
              <button onClick={regeneratePushSecret} disabled={pushSecretSaving} style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: pushSecretSaving ? "not-allowed" : "pointer", flexShrink: 0, color: c.muted }}>
                {pushSecretSaving ? "…" : pushSecret ? "Regenerate" : "Generate"}
              </button>
            </div>

            <div style={{ fontSize: 11.5, color: c.hint, marginTop: 10 }}>Live today on Accounts (the "Push to ERP" action on an account's page) -- extends to other objects the same way.</div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: c.hint }}>Ask a workspace admin to configure this.</div>
        )}
      </Section>
    </div>
  );
}
