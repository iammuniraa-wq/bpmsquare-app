"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFeel } from "@/components/FeelProvider";
import { c } from "@/lib/theme";
import type { TenantConfig } from "@/lib/constants";
import { useTenant, useUserRole } from "@/lib/tenant-context";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { Input } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { AdminOnlyNotice, Section, useSavedFlash } from "@/components/settings/generalShared";
import WebhooksPanel from "./WebhooksPanel";
import { useWebhooksLibrary } from "../webhooks/flag";
import { WEBHOOKS_ROUTE } from "../webhooks/logic";

export default function WebhooksAndPushPage() {
  const tenant = useTenant();
  const role = useUserRole();
  // With the Webhooks library on, this page is replaced by Settings > Webhooks; the address redirects there.
  const library = useWebhooksLibrary();
  const router = useRouter();
  useEffect(() => { if (library) router.replace(WEBHOOKS_ROUTE); }, [library, router]);

  // Push to external systems (on demand) -- see lib/webhookPush.ts
  const pushConfig = (tenant?.config as TenantConfig | undefined)?.integration_push;
  const [pushUrl, setPushUrl] = useState(pushConfig?.webhook_url ?? "");
  const [storedUrl, setStoredUrl] = useState((pushConfig?.webhook_url ?? "").trim());
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
      if (res.ok) { setStoredUrl(pushUrl.trim()); flashPushSaved(); }
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

  if (library) return null;

  if (role !== "admin") {
    return (
      <div style={{ maxWidth: 680 }}>
        <SettingsPageHeader title="Webhooks & push" subtitle="Send events and single records to your other systems." />
        <AdminOnlyNotice what="configure webhooks and push to external systems" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader title="Webhooks & push" subtitle="Send events and single records to your other systems." />

      <SettingsSave dirty={pushUrl.trim() !== storedUrl} saving={pushSaving} saved={pushSaved} error={pushError} onSave={savePushUrl} />

      <WebhooksPanel />

      <Section
        id="push"
        title="Push to external systems"
        description="Send a single record to your ERP or another system right now, on demand -- a rep clicking &quot;Push to ERP&quot; on a record. Different from the outbound webhooks above (automatic, event-driven)."
      >
        {role === "admin" ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <label className="bpm-t-label" style={{ display: "block", marginBottom: 5 }}>Receiving URL</label>
              <Input
                aria-label="Receiving URL"
                value={pushUrl}
                onChange={(e) => setPushUrl(e.target.value)}
                placeholder="https://your-erp.example.com/webhooks/bpmsquare"
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: c.panel2, borderRadius: 8, border: `1px solid ${c.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="bpm-t-help" style={{ marginBottom: 2 }}>Signing secret</div>
                {pushSecret ? (
                  <code style={{ fontSize: 12.5, color: c.ink, fontFamily: "monospace", wordBreak: "break-all" }}>{pushSecret}</code>
                ) : (
                  <div style={{ fontSize: 12.5, color: c.hint, fontStyle: "italic" }}>Not generated -- pushes will be unsigned</div>
                )}
                <div className="bpm-t-help" style={{ marginTop: 3 }}>Sent as the X-BPMSquare-Signature header (HMAC-SHA256 of the request body) so your endpoint can verify it's really from BPMSquare.</div>
              </div>
              <Button onClick={regeneratePushSecret} loading={pushSecretSaving}>{pushSecret ? "Regenerate" : "Generate"}</Button>
            </div>

            <div className="bpm-t-help" style={{ marginTop: 10 }}>Live today on Accounts (the "Push to ERP" action on an account's page) -- extends to other objects the same way.</div>
          </>
        ) : (
          <div className="bpm-t-help">Ask a workspace admin to configure this.</div>
        )}
      </Section>
    </div>
  );
}
