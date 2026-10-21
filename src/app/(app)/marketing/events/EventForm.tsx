"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { EVENT_TIPS, eventDateTip } from "@/lib/marketing/events/tips";
import { EVENT_KINDS, EVENT_STATUSES, FOLLOW_UP_LABEL, KIND_HINT, KIND_LABEL, LIMITS, STATUS_HINT, STATUS_LABEL, type EventKind, type EventStatus, type FollowUpOn } from "@/lib/marketing/events/rules";

// One form for a new event and for editing one (the record's Details tab). Dates and times are the workspace's wall
// clock; the server turns them into an instant in the workspace's time zone.

export type EventFormValues = {
  name: string; kind: EventKind; status: EventStatus; date: string; time: string; end_time: string; venue: string; link: string;
  capacity: string; description: string; form_id: string; follow_up_journey_id: string; follow_up_on: FollowUpOn; owner_user_id: string;
};

type Pick = { id: string; name: string; status?: string };

export default function EventForm({ mode, id, initial, forms, journeys, members, timezone, canEdit }: {
  mode: "create" | "edit"; id?: string; initial: EventFormValues; forms: Pick[]; journeys: Pick[];
  members: { user_id: string; name: string | null; email: string | null }[]; timezone: string; canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [v, setV] = useState<EventFormValues>(initial);
  const set = (k: keyof EventFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setSaved(false); setV((x) => ({ ...x, [k]: e.target.value })); };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) { setError("Give the event a name"); return; }
    if (!v.date) { setError("Choose the date"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(mode === "create" ? "/api/marketing-events" : `/api/marketing-events/${id}`, {
        method: mode === "create" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, capacity: v.capacity === "" ? null : Number(v.capacity) }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) { setError(j.error ?? "Could not save the event"); return; }
      if (mode === "create" && j.id) { router.push(ROUTES.marketingEvent(j.id)); return; }
      setSaved(true);
      router.refresh();
    });
  }

  const dis = !canEdit || pending;
  const cards = (
    <>
      <Card padding={18} title="The event">
        <Field label="Name" required><Input value={v.name} onChange={set("name")} maxLength={LIMITS.name} disabled={dis} placeholder="e.g. Precast open day, Riyadh" autoFocus={mode === "create"} /></Field>
        <div className="fg2">
          <Field label="Kind" info={KIND_HINT[v.kind]}>
            <Select value={v.kind} onChange={set("kind")} disabled={dis}>{EVENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
          </Field>
          <Field label="Status" info={STATUS_HINT[v.status]}>
            <Select value={v.status} onChange={set("status")} disabled={dis}>{EVENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
          </Field>
          <Field label="Date" required info={eventDateTip(timezone)}><Input type="date" value={v.date} onChange={set("date")} disabled={dis} /></Field>
          <Field label="Starts"><Input type="time" value={v.time} onChange={set("time")} disabled={dis} /></Field>
          <Field label="Ends (optional)"><Input type="time" value={v.end_time} onChange={set("end_time")} disabled={dis} /></Field>
          <Field label="Capacity (optional)" info={EVENT_TIPS.capacity}><Input type="number" min={1} value={v.capacity} onChange={set("capacity")} disabled={dis} /></Field>
        </div>
        <Field label="Venue" info={EVENT_TIPS.venue}><Input value={v.venue} onChange={set("venue")} maxLength={LIMITS.venue} disabled={dis} /></Field>
        <Field label="Link" info={EVENT_TIPS.link}><Input value={v.link} onChange={set("link")} maxLength={LIMITS.link} disabled={dis} placeholder="https://" inputMode="url" /></Field>
        <Field label="Owner" info={EVENT_TIPS.owner}>
          <Select value={v.owner_user_id} onChange={set("owner_user_id")} disabled={dis}>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
          </Select>
        </Field>
        <Field label="About it" info={EVENT_TIPS.about} style={{ marginBottom: 0 }}><Textarea value={v.description} onChange={set("description")} rows={3} maxLength={LIMITS.description} disabled={dis} /></Field>
      </Card>

      <Card padding={18} title="Registration">
        <Field label="Registration form" info={EVENT_TIPS.registrationForm} style={{ marginBottom: 0 }}>
          <Select value={v.form_id} onChange={set("form_id")} disabled={dis}>
            <option value="">No form yet</option>
            {forms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.status && f.status !== "live" ? ` (${f.status})` : ""}</option>)}
          </Select>
        </Field>
      </Card>

      <Card padding={18} title="Follow-up">
        <div className="fg2">
          <Field label="Journey" info={EVENT_TIPS.journey}>
            <Select value={v.follow_up_journey_id} onChange={set("follow_up_journey_id")} disabled={dis}>
              <option value="">None</option>
              {journeys.map((j) => <option key={j.id} value={j.id}>{j.name}{j.status && j.status !== "live" ? ` (${j.status})` : ""}</option>)}
            </Select>
          </Field>
          <Field label="For" info={EVENT_TIPS.followUpFor}>
            <Select value={v.follow_up_on} onChange={set("follow_up_on")} disabled={dis}>{(["attended", "no_show"] as const).map((k) => <option key={k} value={k}>{FOLLOW_UP_LABEL[k]}</option>)}</Select>
          </Field>
        </div>
      </Card>
    </>
  );

  if (mode === "create") {
    return (
      <ObjectFormPage backHref={ROUTES.marketingEvents} backLabel="All events" title="New event" subtitle="Plan it now; link a registration form when you are ready to open registration." onSubmit={submit} saving={pending} saveLabel="Create event" error={error} maxWidth={760}>
        {cards}
      </ObjectFormPage>
    );
  }
  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
      {cards}
      {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Button type="submit" variant="primary" disabled={!canEdit || pending} loading={pending}>Save changes</Button>
        {saved && <span role="status" style={{ fontSize: 12.5, color: "var(--muted)" }}>Saved.</span>}
      </div>
    </form>
  );
}
