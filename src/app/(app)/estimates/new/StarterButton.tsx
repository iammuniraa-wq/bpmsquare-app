"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

/** Copies the illustrative precast villa starter into the workspace, then reloads. */
export default function StarterButton({ label = "Start from the precast villa starter", variant = "primary", starter }: { label?: string; variant?: "primary" | "secondary"; starter?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/estimate-templates/from-starter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(starter ? { name: starter } : {}) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Could not add the starter template."); return; }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <Button variant={variant} loading={busy} onClick={go}>{label}</Button>
      {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}
    </div>
  );
}
