"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { useFeel } from "@/components/FeelProvider";
import type { Employee } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { describeImpact, type EmployeeImpact } from "@/lib/wfm/employeeImpactText";
import { isObsolete } from "@/lib/wfm/obsolete";

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Delete, behind a look at what it would destroy. With any work data on file
 * the only action offered is Make obsolete (the server refuses the delete
 * too); an employee with nothing recorded can still be deleted.
 */
export default function RemoveEmployeeDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useFeel();
  const [impact, setImpact] = useState<EmployeeImpact | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = `${employee.first_name} ${employee.last_name}`.trim();
  const obsolete = isObsolete(employee);

  useEffect(() => {
    let live = true;
    fetch(`/api/employees/${employee.id}/impact`)
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) setImpact(j as EmployeeImpact);
        else setError(j.error ?? "Could not check this employee's records");
      })
      .catch(() => { if (live) setError("Could not check this employee's records"); });
    return () => { live = false; };
  }, [employee.id]);

  async function run(method: "DELETE" | "PATCH") {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/employees/${employee.id}`, {
      method,
      ...(method === "PATCH" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "inactive" }) } : {}),
    });
    setBusy(false);
    if (res.ok) {
      toast({ text: method === "DELETE" ? `${name} deleted` : `${name} is now obsolete`, tone: "success" });
      onClose();
      router.refresh();
      return;
    }
    const j = await res.json().catch(() => ({}));
    setError(j.error ?? "Something went wrong");
  }

  const lines = impact ? describeImpact(impact) : [];
  const hasData = !!impact && impact.total > 0;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,32,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Delete ${name}`} style={{ width: 460, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto" }}>
        <Card title={hasData ? `${name} can't be deleted` : `Delete ${name}?`} padding={20}>
          {!impact && !error && <div style={{ fontSize: 13, color: c.muted, marginBottom: 14 }}>Checking records…</div>}

          {impact && !hasData && (
            <div style={{ fontSize: 13, color: c.ink, marginBottom: 14 }}>Nothing is recorded for this employee, so nothing will be lost.</div>
          )}

          {hasData && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: c.ink, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                Deleting would erase:
                <InfoTip label="Why delete is blocked">
                  Deleting removes these records for good and they vanish from every report. Make obsolete keeps them, and the employee stays in reports up to that date.
                </InfoTip>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: c.ink, lineHeight: 1.7 }}>
                {lines.map((l) => <li key={l}>{l}</li>)}
              </ul>
              {impact.first_punch && impact.last_punch && (
                <div style={{ fontSize: 12.5, color: c.muted, marginTop: 8 }}>
                  Punches from {fmtDay(impact.first_punch)} to {fmtDay(impact.last_punch)}.
                </div>
              )}
              {obsolete && <div style={{ fontSize: 12.5, color: c.muted, marginTop: 8 }}>This employee is already obsolete.</div>}
            </div>
          )}

          {error && (
            <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "var(--err-ink)", marginBottom: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={onClose} style={{ minHeight: 44 }}>Cancel</Button>
            {impact && !hasData && (
              <Button variant="danger" loading={busy} onClick={() => { void run("DELETE"); }} style={{ minHeight: 44 }}>Delete</Button>
            )}
            {hasData && !obsolete && (
              <Button variant="primary" loading={busy} onClick={() => { void run("PATCH"); }} style={{ minHeight: 44 }}>Make obsolete</Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
