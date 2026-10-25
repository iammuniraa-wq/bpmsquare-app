"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MoreMenu from "@/components/ui/MoreMenu";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES } from "@/lib/constants";

/** The "..." menu of a project: close or reopen it, or delete one that never had a baseline approved. */
export default function ProjectMenu({ projectId, status, canEdit, deletable }: { projectId: string; status: string; canEdit: boolean; deletable: boolean }) {
  const router = useRouter();
  const { confirm } = useFeel();
  const [error, setError] = useState("");

  async function setStatus(next: "closed" | "active") {
    setError("");
    const res = await fetch(`/api/contract-projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Could not change the status"); return; }
    router.refresh();
  }
  async function remove() {
    if (!(await confirm({ title: "Delete this project?", body: "The draft budget goes with it. This cannot be undone.", confirmLabel: "Delete" }))) return;
    const res = await fetch(`/api/contract-projects/${projectId}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Could not delete"); return; }
    router.push(ROUTES.contractProjects);
  }
  if (!canEdit) return null;
  return (
    <>
      <MoreMenu items={[
        { label: "Close project", onSelect: () => { void setStatus("closed"); }, hidden: status !== "active" },
        { label: "Reopen project", onSelect: () => { void setStatus("active"); }, hidden: status !== "closed" },
        { label: "Delete", danger: true, onSelect: () => { void remove(); }, hidden: !deletable },
      ]} />
      {error && <span role="alert" style={{ fontSize: 12, color: "var(--err-ink)" }}>{error}</span>}
    </>
  );
}
