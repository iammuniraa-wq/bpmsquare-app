"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { ROUTES } from "@/lib/constants";

type Existing = { id: string; ref: string };

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The case page's one way to raise a work order: a date, an optional technician, one button. */
export default function CreateWorkOrder({
  caseId, caseRef, technicians, defaultTechnicianId,
}: {
  caseId: string;
  caseRef: string;
  technicians: { id: string; name: string }[];
  defaultTechnicianId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayLocal);
  const [technicianId, setTechnicianId] = useState(defaultTechnicianId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [existing, setExisting] = useState<Existing[]>([]);

  async function submit(confirmAnother: boolean) {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          scheduled_for: date || undefined,
          technician_id: technicianId || undefined,
          confirm_another: confirmAnother || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setOpen(false);
        setExisting([]);
        router.push(ROUTES.workOrder(json.id));
        router.refresh();
        return;
      }
      if (res.status === 409 && json.code === "open_work_order_exists") {
        setExisting((json.existing ?? []) as Existing[]);
        return;
      }
      setErr(json.error ?? "Could not create the work order");
    } catch {
      setErr("Could not create the work order");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setExisting([]);
    setErr("");
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Create work order
      </Button>
      {open && (
        <SidePanel
          title="Create work order"
          subtitle={caseRef}
          onClose={close}
          footer={
            existing.length === 0 ? (
              <Button variant="primary" onClick={() => submit(false)} loading={busy} style={{ minHeight: 44 }}>
                {busy ? "Creating…" : "Create work order"}
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setExisting([])} style={{ minHeight: 44 }}>Back</Button>
                <Button variant="primary" onClick={() => submit(true)} loading={busy} style={{ minHeight: 44 }}>Create another</Button>
              </>
            )
          }
        >
          {existing.length > 0 ? (
            <div role="alert" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
              This case already has an open work order:{" "}
              {existing.map((w, i) => (
                <span key={w.id}>
                  {i > 0 && ", "}
                  <Link href={ROUTES.workOrder(w.id)} style={{ fontFamily: "monospace", fontWeight: 600 }}>{w.ref}</Link>
                </span>
              ))}
              . Create another only if a second visit is needed.
            </div>
          ) : (
            <>
              <Field label="Scheduled date">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ minHeight: 44 }} />
              </Field>
              <Field label="Technician">
                <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} style={{ minHeight: 44 }}>
                  <option value="">Not assigned</option>
                  {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
            </>
          )}
          {err && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{err}</div>}
        </SidePanel>
      )}
    </>
  );
}
